/** Public invite references contain no session, RPC credentials or transaction secrets. */
export function expeditionLink(href:string,match:string,network:'local'|'devnet',watch=false,protocol:2|3=2){
 const u=new URL(href);u.search='';u.hash='';u.username='';u.password='';u.searchParams.set('version',String(protocol));u.searchParams.set('cluster',network);u.searchParams.set(watch?'watch':'match',match);return u.href;
}
/** Private choices never enter this URL. A public recovery origin must be configured explicitly. */
export function recoveryLink(href:string,match:string,network:'local'|'devnet',origin?:string,protocol:2|3=2){
 const main=new URL(href),local=['127.0.0.1','localhost','[::1]'].includes(main.hostname);
 if(!origin&&!local)return null;
 const u=new URL(origin??`${main.protocol}//${main.hostname}:4174`);
 if(u.username||u.password||u.hash||u.search||u.pathname!=='/'||u.protocol!=='https:'&&!(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)))throw Error('Use an HTTPS or loopback recovery origin without credentials');
 u.searchParams.set('version',String(protocol));u.searchParams.set('match',match);u.searchParams.set('cluster',network);return u.href;
}
