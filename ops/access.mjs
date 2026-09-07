const decode=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
export function createAccessVerifier(fetchImpl=fetch,now=()=>Date.now()) {
  let cached;
  return async function verify(request,env) {
    const domain=env.ACCESS_TEAM_DOMAIN,aud=env.ACCESS_AUD,owner=env.OPS_OWNER_EMAIL||env.OWNER_EMAIL;
    if(!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain||'')||!aud||!owner)return false;
    const token=request.headers.get('Cf-Access-Jwt-Assertion');
    if(!token||token.length>16000)return false;
    try {
      const [head,body,sig,...extra]=token.split('.'); if(extra.length||!sig)return false;
      const h=JSON.parse(new TextDecoder().decode(decode(head))),c=JSON.parse(new TextDecoder().decode(decode(body)));
      if(h.alg!=='RS256'||c.iss!=='https://'+domain||!Array.isArray(c.aud)||!c.aud.includes(aud)||typeof c.exp!=='number'||c.exp*1000<=now()||(c.nbf&&c.nbf*1000>now()+30000)||typeof c.email!=='string'||c.email.toLowerCase()!==owner.toLowerCase())return false;
      if(!cached||cached.domain!==domain||cached.until<now()||(!cached.keys.some(k=>k.kid===h.kid)&&now()-cached.fetchedAt>60000)) {
        const r=await fetchImpl('https://'+domain+'/cdn-cgi/access/certs',{signal:AbortSignal.timeout(8000)});
        if(!r.ok)return false;
        const jwks=await r.json(); if(!Array.isArray(jwks.keys)||jwks.keys.length>20)return false;
        cached={domain,until:now()+3600000,fetchedAt:now(),keys:jwks.keys};
      }
      const jwk=cached.keys.find(k=>k.kid===h.kid&&k.kty==='RSA'); if(!jwk)return false;
      const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
      return await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(sig),new TextEncoder().encode(head+'.'+body));
    } catch {return false;}
  };
}
