"use client";

// regular session provider from next-auth, but reexported with "use client" to make it work in next.js layout (which is rendered on server)
export { SessionProvider } from "next-auth/react";
