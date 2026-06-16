# oRPC internals: how hard is it to OWN the HTTP-serving layer?

Research target: `@orpc/server`, `@orpc/openapi`, `@orpc/openapi-client`, `@orpc/client`,
`@orpc/contract`, `@orpc/standard-server*` at **v1.14.6**.

Sources read (real dist):
- `aftrak/web/node_modules/.pnpm/@orpc+server@1.14.6_.../dist/...` (server core + adapters)
- `aftrak/web/node_modules/.pnpm/@orpc+standard-server@1.14.6/.../dist/index.mjs`
- `aftrak/web/node_modules/.pnpm/@orpc+standard-server-fetch@1.14.6/.../dist/index.mjs`
- `aftrak/web/node_modules/.pnpm/@orpc+client@1.14.6_.../dist/shared/client.D9eWXdBV.mjs`
- `aftrak/web/node_modules/.pnpm/@orpc+contract@1.14.6_.../dist/...`
- `@orpc/openapi@1.14.6` + `@orpc/openapi-client@1.14.6` (downloaded via `npm pack`, since aftrak
  only installs `client`/`server`/`tanstack-query`, NOT the openapi packages).

---

## TL;DR verdict

**Owning a minimal standard-OpenAPI HTTP handler is genuinely easy — roughly a day, ~250-400 LOC.**
Our use case (orval-generated hooks → plain JSON REST endpoints) deliberately sidesteps almost
everything that makes oRPC's serving layer big.

The bulk of oRPC's serving complexity exists to support **its own RPC wire protocol** (`RPCHandler`,
super-JSON-style typed codec, RPC client) and **edge features** (file uploads, SSE/event-iterators,
"detailed" input/output structures, bracket-notation nested-query encoding, lazy/contract-first
routers, hibernation, plugins, OTel spans). **None of those are on the critical path for plain JSON
in / plain JSON out.**

The one piece that is non-trivial and worth keeping an eye on is the **OpenAPI spec generator**
(`@orpc/openapi`, ~880 LOC of Standard-Schema→JSON-Schema massaging). But that is *decoupled* from
serving — you can use one without the other. And orval needs a spec from us regardless of how we
serve.

Recommendation: **own the handler, strongly consider owning the spec-gen too** (or use a thin
schema-library-native converter like `zod-to-json-schema`), and **do not adopt oRPC's RPC stack at
all** for the orval path. See the effort table at the end.

---

## 1. Layer map — which layers matter for us

oRPC ships two parallel "handler" families on top of one shared engine.

```
                          @orpc/contract  (route config, ORPCError, defaults, Standard-Schema glue)
                                  |
   ┌──────────────────────────── @orpc/server (StandardHandler engine: match→decode→validate→call→encode) ───────────────────────────┐
   |                                                                                                                                    |
   |   RPCHandler  (server/dist/...)                            OpenAPIHandler  (@orpc/openapi)                                          |
   |   ── custom RPC wire protocol                              ── standard REST: rou3 path matching, JSON body,                         |
   |   ── StandardRPCCodec + super-JSON serializer             ── query/path params, bracket-notation, OpenAPI status codes            |
   |   ── pairs with RPCLink (the @orpc RPC client)            ── StandardOpenAPICodec + StandardOpenAPISerializer                      |
   |                                                                                                                                    |
   └─ adapters: fetch / node / aws-lambda / fastify / bun-ws / ws / crossws / message-port (Request/Response ↔ "standard" request) ────┘
                                  |
   @orpc/standard-server  (transport-neutral helpers: SSE encode/decode, content-disposition, header merge)
   @orpc/standard-server-fetch / -node  (Request/Response ↔ standard-request adapters)
```

| Layer | Package / file | Relevant to us? |
|---|---|---|
| **`OpenAPIHandler`** (standard REST) | `@orpc/openapi` `dist/shared/openapi.BB-W-NKv.mjs` (~205 LOC) | **YES** — this is the match we'd replicate |
| `RPCHandler` (custom RPC protocol) | `@orpc/server` core | **NO** — only needed by the oRPC RPC client; orval doesn't use it |
| `StandardHandler` engine | `@orpc/server` `dist/shared/server.ZxHCEN1h.mjs` (~226 LOC) | **YES (concept)** — the lifecycle we'd reimplement (small) |
| OpenAPI spec generator | `@orpc/openapi` `dist/shared/openapi.BwdtJjDu.mjs` (~880 LOC) | **YES** — orval needs a spec; decoupled from serving |
| `StandardOpenAPISerializer` (JSON + bracket) | `@orpc/openapi-client` `dist/shared/openapi-client.B2Q9qU5m.mjs` (~300 LOC) | **PARTLY** — JSON codec yes, bracket-notation only for nested query/form |
| `StandardBracketNotationSerializer` | `@orpc/openapi-client` `dist/shared/openapi-client.t9fCAe3x.mjs` (~146 LOC) | **MOSTLY NO** — only for nested objects in query/form |
| fetch adapter | `@orpc/server` `dist/adapters/fetch/index.mjs` (~167 LOC) | **YES (concept)** — trivial Request↔standard glue |
| `ORPCError` + status table | `@orpc/client` `dist/shared/client.D9eWXdBV.mjs` | **YES** — the error→status mapping, ~80 LOC, trivial to copy |
| RPC super-JSON serializer | `@orpc/client` RPC codec | **NO** — RPC protocol only |
| event-iterator / SSE | `@orpc/standard-server` `dist/index.mjs` (~268 LOC) | **NO** (MVP) — only if we want streaming |
| plugins, hibernation, batch, peer, ws | various | **NO** |

**Conclusion for the framing question:** our client is orval-generated hooks hitting a standard
OpenAPI/REST endpoint. That maps to **`OpenAPIHandler` + the OpenAPI spec generator**, and explicitly
**NOT** to `RPCHandler` / `RPCLink` / the super-JSON RPC codec. The entire RPC half of oRPC is
irrelevant to us.

---

## 2. Request lifecycle for the OpenAPI handler (end to end)

The engine lives in `StandardHandler.handle()`
(`@orpc/server/dist/shared/server.ZxHCEN1h.mjs`, lines ~33-112). `StandardOpenAPIHandler` just
plugs in an OpenAPI-flavoured matcher + codec:

```js
// @orpc/openapi/dist/shared/openapi.BB-W-NKv.mjs:193
class StandardOpenAPIHandler extends StandardHandler {
  constructor(router, options) {
    const jsonSerializer = new StandardOpenAPIJsonSerializer(options);
    const bracketNotationSerializer = new StandardBracketNotationSerializer(options);
    const serializer = new StandardOpenAPISerializer(jsonSerializer, bracketNotationSerializer);
    const matcher = new StandardOpenAPIMatcher(options);
    const codec   = new StandardOpenAPICodec(serializer, options);
    super(router, matcher, codec, options);
  }
}
```

The lifecycle (stripped of OTel spans / interceptors):

1. **Prefix check** — bail with `{matched:false}` if pathname doesn't start with the mount prefix.
2. **Route match** — `matcher.match(method, "/<pathname>")`.
3. **Decode input** — `codec.decode(request, params, procedure)`. (`step = "decode_input"`)
4. Wrap input in a span if it's an async iterator (irrelevant to us).
5. **Build procedure client** and **call it** — `client(input, {signal, lastEventId})`
   (`step = "call_procedure"`). Input/output validation happens *inside* this client.
6. **Encode output** — `codec.encode(output, procedure)` → `{status, headers, body}`.
7. **Error path** — any throw is caught; if it happened during `decode_input` and isn't already an
   `ORPCError`, it becomes `BAD_REQUEST` (400); otherwise `toORPCError(e)`. Then
   `codec.encodeError(error)`.

```js
// StandardHandler.handle() — error mapping excerpt
const error = step === "decode_input" && !(e instanceof ORPCError)
  ? new ORPCError("BAD_REQUEST", { message: "Malformed request. ...", cause: e })
  : toORPCError(e);
const response = this.codec.encodeError(error);
return { matched: true, response };
```

### 2a. Route matching — `StandardOpenAPIMatcher`
Uses the tiny **`rou3`** trie router (external dep). Patterns are translated from OpenAPI `{param}`
syntax to rou3 syntax:

```js
// openapi.BB-W-NKv.mjs:113
function toRou3Pattern(path) {
  return standardizeHTTPPath(path)
    .replace(/\/\{\+([^}]+)\}/g, "/**:$1")   // {+rest} -> wildcard
    .replace(/\/\{([^}]+)\}/g,  "/:$1");      // {id}    -> :id
}
```
Match returns `{path, procedure, params}`; params are URI-decoded
(`decodeParams` → `tryDecodeURIComponent`). There's also lazy/contract-first router resolution
(`pendingRouters`, `unlazy`) — **we don't need lazy routers.**

### 2b. Input decoding — `StandardOpenAPICodec.decode`
For the default **"compact"** input structure (the only one we'd use):

```js
// openapi.BB-W-NKv.mjs:16
async decode(request, params, procedure) {
  const inputStructure = ...; // "compact" by default
  if (inputStructure === "compact") {
    const data = request.method === "GET"
      ? this.serializer.deserialize(request.url.searchParams)   // query → object
      : this.serializer.deserialize(await request.body());      // JSON body → object
    if (data === void 0) return params;
    if (isObject(data)) return { ...params, ...data };          // merge path params
    return data;
  }
  // "detailed": returns { params, query, headers, body } separately
}
```

So for a `POST` with a JSON body and a `{id}` path param, the handler input is
`{ ...pathParams, ...jsonBody }`. For `GET`, it's `{ ...pathParams, ...queryParams }`.
`request.body()` is the standard-server body parser
(`@orpc/standard-server-fetch` `toStandardBody`) which content-type-switches between JSON / FormData /
URLSearchParams / SSE / Blob.

### 2c. Input validation
Inside the procedure client (`@orpc/server/dist/shared/server.DEBcqOjg.mjs:152`):

```js
async function validateInput(procedure, input) {
  const schema = procedure["~orpc"].inputSchema;
  if (!schema) return input;
  const result = await schema["~standard"].validate(input);   // Standard Schema!
  if (result.issues) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Input validation failed",
      data: { issues: result.issues },
      cause: new ValidationError({ ... issues: result.issues, data: input }),
    });
  }
  return result.value;
}
```
Note: validation is via the **Standard Schema** `~standard.validate` contract — exactly what we
already plan to use. Input failure → `BAD_REQUEST` (400) with `data.issues` carrying the raw issues.

### 2d. Invoke handler / output validation
`createProcedureClient` runs middlewares (we have none), calls the handler, then `validateOutput`:

```js
async function validateOutput(procedure, output) {
  const schema = procedure["~orpc"].outputSchema;
  if (!schema) return output;
  const result = await schema["~standard"].validate(output);
  if (result.issues) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", { ... }); // output fail → 500
  }
  return result.value;
}
```

### 2e. Output serialization + response building
```js
// openapi.BB-W-NKv.mjs:48  (compact)
encode(output, procedure) {
  const successStatus = ...; // 200 default
  return { status: successStatus, headers: {}, body: this.serializer.serialize(output) };
}
encodeError(error) {
  return { status: error.status, headers: {},
           body: this.serializer.serialize(error.toJSON(), { outputFormat: "plain" }) };
}
```
The `{status, headers, body}` "standard response" is then turned into a real `Response` by the
adapter (§6).

---

## 3. The genuinely hard parts — and do WE need them?

| oRPC machinery | What it does | Where | Do WE need it (plain JSON OpenAPI + orval)? |
|---|---|---|---|
| **super-JSON RPC codec** (Date/Map/Set/bigint/File round-trip with a `meta` side-channel) | Lossless typed serialization for the **RPC** protocol | `@orpc/client` RPC codec (NOT in openapi) | **NO.** This is the RPC protocol. Standard OpenAPI uses plain JSON. |
| **`StandardOpenAPIJsonSerializer`** (one-way JSON normalize: Date→ISO, Set→array, Map→entries, bigint/URL/RegExp→string, NaN→null, Blob detect) | Down-converts rich JS values to JSON-safe values **for output** | `openapi-client.B2Q9qU5m.mjs:8` | **Barely.** ~45 LOC, trivial to copy if our handlers ever return `Date`/`Set`. For pure JSON in/out you can even use `JSON.stringify`. Keep as a tiny optional helper. |
| **Bracket-notation encode/decode** (`a[b][0]=x` ↔ nested object/array) | Encodes nested objects/arrays into flat query/form keys, decodes back | `openapi-client.t9fCAe3x.mjs` (~146 LOC) | **MOSTLY NO.** Only matters for **nested objects in query strings or form fields**. If our query params are flat scalars (the common REST case), `URLSearchParams` is enough. This is the single fiddliest file (push-style `a[]=` arrays, array→object promotion, escaping). Skip until a user actually nests query objects. |
| **String→typed coercion of params** | `"123"`→`123`, `"true"`→`true` for path/query | **Not done by oRPC core** — see note below | **YES eventually, but it's on the schema side.** The bracket/JSON deserializers return **strings**. oRPC relies on the *schema converter / schema library* to coerce (e.g. zod's coercion, or oRPC's experimental input-coercion plugin). For us: use `z.coerce.*` (or valibot equivalents) in `inputSchema`, OR add a coercion pass. **MVP can punt** if path/query inputs are already strings or you coerce in schema. |
| **multipart / file uploads** | `File`/`Blob` in request/response, content-disposition | `standard-server` + serializers | **NO (MVP).** Defer. Long-tail only if you serve binary. |
| **streaming / event-iterator / SSE** | Async-generator handlers → `text/event-stream`, keepalive, resume via `last-event-id` | `@orpc/standard-server` `index.mjs` (~268 LOC) | **NO (MVP).** Big chunk of oRPC, entirely skippable unless we add streaming endpoints. |
| **content-type negotiation** (JSON / form-urlencoded / multipart / event-stream / text / blob) | Picks a body parser by `content-type` | `standard-server-fetch` `toStandardBody` | **MINIMAL.** We only need `application/json` (+ maybe form-urlencoded). ~10 LOC. |
| **"detailed" input/output structures** | `{params, query, headers, body}` in, `{status, headers, body}` out | codec + spec-gen | **NO (MVP).** Default is "compact"; detailed is opt-in. Skip unless a handler needs custom status/headers. |
| **lazy / contract-first routers, hibernation, plugins, batch, peer, ws** | Code-splitting routers, durable-object hibernation, request batching, websockets | server core + plugins | **NO.** Not applicable to a simple function registry. |

**Net:** the only "hard part" that is even arguably on our path is **bracket-notation nested
query/form** and **param coercion**, and both are deferrable / schema-side. Everything else big in
oRPC is RPC-protocol or edge-feature surface area we don't touch.

---

## 4. Error handling → HTTP status

`ORPCError` (`@orpc/client/dist/shared/client.D9eWXdBV.mjs:91`) carries `{defined, code, status,
message, data}`. Status is resolved from a fixed table:

```js
// client.D9eWXdBV.mjs:6  (COMMON_ORPC_ERROR_DEFS)
BAD_REQUEST:400, UNAUTHORIZED:401, FORBIDDEN:403, NOT_FOUND:404, METHOD_NOT_SUPPORTED:405,
NOT_ACCEPTABLE:406, TIMEOUT:408, CONFLICT:409, PRECONDITION_FAILED:412, PAYLOAD_TOO_LARGE:413,
UNSUPPORTED_MEDIA_TYPE:415, UNPROCESSABLE_CONTENT:422, TOO_MANY_REQUESTS:429,
CLIENT_CLOSED_REQUEST:499, INTERNAL_SERVER_ERROR:500, NOT_IMPLEMENTED:501, BAD_GATEWAY:502,
SERVICE_UNAVAILABLE:503, GATEWAY_TIMEOUT:504
```

```js
function fallbackORPCErrorStatus(code, status) {
  return status ?? COMMON_ORPC_ERROR_DEFS[code]?.status ?? 500;
}
function isORPCErrorStatus(status) { return status < 200 || status >= 400; } // "this is an error response"
```

Error response body is `error.toJSON()`:
```js
toJSON() { return { defined: this.defined, code: this.code, status: this.status,
                    message: this.message, data: this.data }; }
```

Validation errors specifically:
- **Input** invalid → `ORPCError("BAD_REQUEST")` (400), `data.issues = [...standard-schema issues]`.
- **Output** invalid → `ORPCError("INTERNAL_SERVER_ERROR")` (500).
- **Malformed body / decode failure** → `BAD_REQUEST` (400).
- Unknown thrown value → `toORPCError` wraps to `INTERNAL_SERVER_ERROR` (500).

This whole subsystem is ~80 trivial LOC to own. We'd define our own `FnError` (or reuse this
shape — it's a clean JSON contract orval-side already understands as just a JSON error body).

---

## 5. OpenAPI spec generation — and its coupling to serving

`OpenAPIGenerator.generate(router, opts)` (`openapi.BwdtJjDu.mjs:504`) walks the router/contract,
and for each procedure builds an OpenAPI 3.1.1 operation:
- `method` from `route.method` (default POST), `path` from `route.path` → `toOpenAPIPath`.
- **request**: converts `inputSchema` (Standard Schema) → JSON Schema via a pluggable
  `CompositeSchemaConverter`, then splits it into **path params / query params / requestBody** based
  on input structure + dynamic params + GET-vs-body. (`#request`, lines 647-740.)
- **responses**: success response from `outputSchema` (`#successResponse`), plus an error response
  per status derived from the contract's `errorMap` (`#errorResponse`).
- finally `serializer.serialize(doc)` and returns the doc.

The non-trivial weight here is the **JSON-Schema massaging** (lines 53-485): `LOGIC_KEYWORDS`,
`isAnySchema`/`isNeverSchema`, `separateObjectSchema` (pull path params out of the body schema),
`filterSchemaBranches` (peel `File` schemas into `multipart/form-data`), `simplifyComposedObjectJson
SchemasAndRefs` (flatten anyOf/oneOf/allOf of objects), `expandUnionSchema`, deepObject-vs-explode
decisions in `toOpenAPIParameters`. That's where the ~880 LOC goes.

**BUT:** the generator needs a **schema converter** that turns *your* schema library into JSON
Schema. oRPC ships separate `@orpc/zod`, `@orpc/valibot`, `@orpc/arktype` converter packages for
that — the core generator is converter-agnostic (`CompositeSchemaConverter`).

**Coupling verdict:**
- **Spec-gen and the handler are fully decoupled.** `OpenAPIGenerator` lives in `@orpc/openapi`
  alongside the handler but shares only small helpers (`toOpenAPIPath`, `standardizeHTTPPath`,
  `getDynamicParams`). You can run the generator without ever serving, and serve without the
  generator (the handler matches on routes, not on the spec).
- For **us**: we need a spec for orval no matter what. We have two clean options:
  1. **Own a minimal spec-gen** that handles only our supported schema shapes (objects of scalars +
     nested objects/arrays). With a single fixed schema lib (say zod via `zod-to-json-schema`, which
     aftrak already has) this is far less code than oRPC's library-agnostic monster — because we skip
     the `File`/multipart/event-stream/detailed-structure branches and the union-flattening for
     params.
  2. **Reuse oRPC's `OpenAPIGenerator` + its zod converter** purely as a build-time dep, and still
     own serving. Spec-gen is the part most worth *not* reinventing if we want broad schema support;
     serving is the part most worth owning.

---

## 6. Adapter layer — framework-agnostic ↔ platform Request/Response

The boundary is the **"standard request/response"** shape: a plain object
`{ url:URL, method, headers, signal, body():Promise<...> }` in, `{ status, headers, body }` out.
Adapters are thin translators. The fetch adapter:

```js
// @orpc/server/dist/adapters/fetch/index.mjs (FetchHandler.handle)
const standardRequest = toStandardLazyRequest(request);              // Request -> standard
const result = await this.standardHandler.handle(standardRequest, options);
if (!result.matched) return result;
return { matched: true, response: toFetchResponse(result.response) }; // standard -> Response
```

```js
// @orpc/standard-server-fetch/dist/index.mjs:253 / :280
function toStandardLazyRequest(request) {
  return { url: new URL(request.url), signal: request.signal, method: request.method,
           body: once(() => toStandardBody(request, { signal: request.signal })),
           get headers() { ... toStandardHeaders(request.headers) ... } };
}
function toFetchResponse(response) {
  const headers = toFetchHeaders(response.headers);
  const body = toFetchBody(response.body, headers);   // JSON.stringify / FormData / stream / blob
  return new Response(body, { headers, status: response.status });
}
```

`toStandardBody` is the content-type switch (JSON/FormData/URLSearchParams/SSE/text/blob);
`toFetchBody` picks an outgoing encoding (string JSON / FormData / ReadableStream for SSE / Blob).
For **us**, this entire adapter collapses to: read `await request.json()` (or text + JSON.parse),
read `request.headers`, `new URL(request.url)`; and on the way out `new Response(JSON.stringify(body),
{status, headers:{'content-type':'application/json'}})`. The node adapter is the same idea over
`IncomingMessage`/`ServerResponse`. **~30-50 LOC each, trivial.**

---

## 7. Size / effort estimate

### LOC of each relevant oRPC piece (dist `.mjs`, v1.14.6)
| Piece | LOC |
|---|---|
| OpenAPI handler (matcher + codec + handler class) | ~205 |
| OpenAPI spec generator + schema massaging | ~880 |
| StandardHandler engine (incl. interceptors/spans) | ~226 |
| validate/middleware/procedure-client shared | ~418 |
| OpenAPI JSON serializer + serializer wrapper + link codec | ~302 |
| bracket-notation serializer | ~146 |
| `ORPCError` + status table + helpers | ~150 (we'd use ~80) |
| standard-server (SSE/headers/content-disposition) | ~268 |
| standard-server-fetch adapter | ~300 |
| fetch server adapter | ~167 |

Most of those LOC are RPC-protocol, edge-features, OTel spans, interceptor plumbing, and
library-agnostic schema gymnastics that **we don't need**.

### What WE'D actually build for the MVP (standard JSON OpenAPI)
A minimal owned handler that: matches route+method, parses JSON body + path + query params,
validates input via Standard Schema, calls our fn, validates output, maps errors→status, returns
JSON.

| MVP component | Est. LOC | Notes |
|---|---|---|
| Route table + matcher | 40-100 | Use `rou3` (same dep oRPC uses) or a small regex matcher. `{id}`→`:id`. |
| Request decode (JSON body + query→object + merge path params) | 30 | `await req.json()`, `Object.fromEntries(url.searchParams)`, merge. |
| Standard-Schema input validation → 400 w/ issues | 20 | `schema['~standard'].validate(input)`. |
| Call handler | 5 | |
| Standard-Schema output validation → 500 | 15 | optional |
| Error → status mapping + JSON error body | 40 | copy the status table + `toJSON` shape. |
| Response build (`new Response(JSON.stringify(...))`) | 20 | |
| fetch + node adapters | 60-100 | two thin translators. |
| **MVP total** | **~250-400 LOC** | ~**0.5-1 day**. |

### The long tail (add only when a real feature needs it)
| Feature | Est. effort | Trigger |
|---|---|---|
| String→typed coercion of path/query params | ~0.5 day (or free via `z.coerce`) | non-string scalar params |
| Bracket-notation nested query/form decode | ~1 day (port oRPC's ~146 LOC) | nested objects in query/form |
| Rich-type output normalization (Date/Set/Map/bigint) | ~0.5 day (port ~45 LOC) | handlers returning rich JS types |
| Multipart / file upload + download | 1-2 days | binary endpoints |
| SSE / streaming / event-iterators | 2-4 days | streaming endpoints (this is a real chunk) |
| Detailed input/output (custom status/headers per route) | ~1 day | per-route status/header control |
| **OpenAPI spec generation** | 2-4 days to own well, OR ~0 days reusing `@orpc/openapi`+`@orpc/zod` build-time | orval needs a spec regardless |

---

## Recommendation: own the handler, decide spec-gen separately

1. **Own the HTTP handler.** It is ~250-400 LOC for a fully standard JSON/OpenAPI experience and
   removes the "we're just an oRPC wrapper" concern. oRPC's serving size is dominated by its **RPC
   protocol** and **edge features we don't use**. Owning it also lets the `{name, description,
   inputSchema, outputSchema, route, handler}` shape stay our own native concept instead of being
   marshalled through oRPC contracts/procedures.

2. **Do NOT adopt the RPC stack** (`RPCHandler`/`RPCLink`/super-JSON codec). It's irrelevant to
   orval-consumes-OpenAPI and is the single biggest source of oRPC complexity.

3. **Spec generation is the one place to think twice.** It's decoupled from serving, and orval needs
   a spec from us either way. Two viable paths:
   - *Lean & owned*: a focused generator over a single schema lib (e.g. zod →
     `zod-to-json-schema`) covering objects/scalars/nested — much smaller than oRPC's
     library-agnostic generator because we drop File/multipart/SSE/detailed/union-param branches.
   - *Reuse at build time*: depend on `@orpc/openapi` + `@orpc/<schemalib>` only as a dev/build
     dependency to emit the spec, while still owning runtime serving. This keeps us off oRPC at
     runtime entirely (no oRPC in the server request path or the shipped client).

4. **Borrow, don't depend, for the small gnarly bits.** The error/status table (~80 LOC), the
   JSON-normalize serializer (~45 LOC), and (later) bracket-notation (~146 LOC) are clean,
   self-contained, MIT-licensed files we can port verbatim when/if needed — no runtime dependency.

5. **Keep `rou3`** as a tiny external dependency for routing (it's well-tested, ~a few KB, and oRPC
   itself relies on it) unless you prefer a hand-rolled matcher.

**Bottom line:** owning the standard-OpenAPI HTTP layer is a low-risk ~1-day MVP. The scary-looking
size of oRPC is mostly its RPC protocol and optional features. The only piece with real ongoing cost
is the spec generator, and that is independently swappable — you can own serving today and decide on
spec-gen (own vs. build-time-reuse) separately.
