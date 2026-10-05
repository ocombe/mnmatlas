'use strict';
// Sign-in window for the atlas embedded on other sites: Discord refuses to load inside a frame,
// so the embed opens this page, which signs in, posts the session to the embed that opened it and keeps nothing itself.
(async()=>{
 const line=document.getElementById('signin-line'),say=message=>{line.textContent=message;};
 const settings=typeof atlasConfig==='object'?atlasConfig:{},storageKey='mnmaps-signin-window';
 const forget=()=>{try{for(const key of Object.keys(localStorage))if(key.startsWith(storageKey))localStorage.removeItem(key);}catch{}};
 let client;
 try{client=window.supabase.createClient(settings.supabaseUrl,settings.supabaseKey,{auth:{flowType:'pkce',storageKey,autoRefreshToken:false,detectSessionInUrl:true}});}
 catch{say('Sign-in could not start. Close this window and try again.');return;}
 const params=new URLSearchParams(location.search);
 if(params.has('error')){forget();say('Discord sign-in was cancelled. Close this window and try again from the map.');return;}
 if(!params.has('code')){
  try{const {error}=await client.auth.signInWithOAuth({provider:'discord',options:{redirectTo:location.origin+location.pathname}});if(error)throw error;}
  catch{say('Discord sign-in could not start. Close this window and try again.');}
  return;
 }
 // Back from Discord: the client swaps the code for a session while it starts.
 let session=null;
 try{({data:{session}}=await client.auth.getSession());}catch{}
 client.auth.stopAutoRefresh();forget();
 history.replaceState(null,'',location.pathname);
 if(!session){say('Discord sign-in could not finish. Close this window and try again from the map.');return;}
 const opener=window.opener;
 if(!opener||opener.closed){say('Signed in, but the map that opened this window is gone. Close this window and sign in again from the map.');return;}
 // Only a page of this same site can receive the session.
 opener.postMessage({type:'mnmaps-session',access_token:session.access_token,refresh_token:session.refresh_token},location.origin);
 say('Signed in. You can close this window.');
 setTimeout(()=>window.close(),400);
})();
