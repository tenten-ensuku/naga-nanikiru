import {createMonitorHandler} from './handler.mjs';
// One-way verifier of a random 256-bit Worker Secret, NOT an API key.
const tokenDigest = 'b2e4e5bf3191150051be2d94573ffe827813bc8ba32e790fe6751add870d13a0';
Deno.serve(createMonitorHandler({digest:tokenDigest,baseUrl:Deno.env.get('SUPABASE_URL'),serviceKey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}));
