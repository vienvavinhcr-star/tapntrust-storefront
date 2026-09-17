import existingWorker from './index';
import {enhanceAdminCrmLabelsPage,handleAdminCrmLabelsRequest} from './admin-crm-labels';

// The existing Worker remains authoritative for everything other than this
// narrowly scoped owner-only CRM endpoint and its dashboard enhancement.
async function ownerAuthorized(request: Request, env: Env & {ADMIN_API_TOKEN?:string}): Promise<boolean> {
  const expected=env.ADMIN_API_TOKEN;
  const authorization=request.headers.get('Authorization')||'';
  const provided=authorization.startsWith('Bearer ')?authorization.slice(7):'';
  if(!provided||!expected)return false;
  const bytes=new TextEncoder();
  const [left,right]=await Promise.all([
    crypto.subtle.digest('SHA-256',bytes.encode(provided)),
    crypto.subtle.digest('SHA-256',bytes.encode(expected))
  ]);
  const a=new Uint8Array(left),b=new Uint8Array(right);
  let diff=0;
  for(let i=0;i<a.length;i++)diff|=(a[i]??0)^(b[i]??0);
  return diff===0;
}

export default {
  async fetch(request:Request,env:Env,ctx:ExecutionContext):Promise<Response> {
    const pathname=new URL(request.url).pathname;
    if(pathname==='/api/admin/customer-crm-labels') {
      if(!(await ownerAuthorized(request,env)))return Response.json({error:'Unauthorized'},{status:401,headers:{'Cache-Control':'no-store'}});
      return (await handleAdminCrmLabelsRequest(request,pathname,env.DB)) as Response;
    }
    const original=await existingWorker.fetch(request,env,ctx);
    if(pathname!=='/admin'||request.method!=='GET'||!original.ok)return original;
    const headers=new Headers(original.headers);
    headers.delete('Content-Length');
    return new Response(enhanceAdminCrmLabelsPage(await original.text()),{
      status:original.status,statusText:original.statusText,headers
    });
  },
  scheduled(event:ScheduledEvent,env:Env,ctx:ExecutionContext) {
    return existingWorker.scheduled(event,env,ctx);
  }
} satisfies ExportedHandler<Env>;
