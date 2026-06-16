
- user should be able to pass in input/output schema
- if input schema is defined then should use z.input to infer TInput, else use void
- if output schema is definde the should use z.output to infer TOutput, HOWEVER (IMPORANTLY) if no output schema is defined then should use the return type of the handler
- we dont want to waste time perfectly settng up all the middleware types are there is ONE main usecase that we need the middleware types to work for (for now). That usecase is in composition.test.ts. I'ts about creating these authed vs public functions. We dont mind casting the ctx type in initCreateFn.