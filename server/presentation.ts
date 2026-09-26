import { randomUUID } from 'node:crypto';
import { agentSpec } from './agent-spec';
import { forge } from './harness';
import { env } from './config';
import { getRun, updateRun } from './store';
import { datasetCatalog, extractViews, VISUAL_INSTRUCTIONS } from '../src/lib/visuals';
// Presentation-only sessions have no research MCP tools, execution grant, or native sandbox.
export async function generatePresentation(id: string) {
  const run = await updateRun(id, r => {
    if (r.phase !== 'completed' || r.presentationPending) throw Error('Complete the investigation or wait for figure generation');
    if (r.trace.filter(t => t.type === 'ui.request').length >= 3) throw Error('Three presentation requests per run');
    r.presentationPending = true;
    r.trace.push({id:randomUUID(),time:new Date().toISOString(),type:'ui.request',title:'Generate evidence figures',detail:'Read-only TrueForge presentation session; no execution tools'});
  });
  let sessionId: string | undefined;
  try {
    const spec = agentSpec(id, env.model);
    spec.mcp_servers = [];
    spec.instructions = `You are the read-only research presentation agent. Use the native TrueForge OpenUI capability. First call get_openui_instructions. The application custom component catalog below overrides the default catalog. Generate a useful dashboard from the supplied dataset catalog. Do not call write_report: the report is already complete. ${VISUAL_INSTRUCTIONS} Include 2 or 3 charts and a compact table when supported. Clearly distinguish t1 training time from t2 generalization time and show seed variation. Do not treat missing t2 values as zero. Discuss the final inconclusive assessments honestly. Output one openui fenced block.`;
    spec.config.iteration_limit = 8;
    const session = await forge('/sessions', {agent:{spec}});
    sessionId = session.data.id;
    const start = await forge(`/sessions/${sessionId}/turns`, {stream:false,input:[{type:'user.message',content:JSON.stringify({paper:run.title,claims:run.claims,catalog:datasetCatalog(run.evidence)})}]});
    const base = `/sessions/${sessionId}/turns/${start.data.id}`;
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      const state = await forge(base);
      if (state.data.state.status !== 'running') {
        const events: any[] = [];
        let page: string | undefined;
        do { const batch = await forge(`${base}/events?limit=100${page ? `&page_token=${encodeURIComponent(page)}` : ''}`); events.push(...batch.data); page=batch.pagination?.next_page_token; } while(page);
        const views = events.filter(e=>e.type==='model.message'&&typeof e.content==='string').flatMap(e=>extractViews(e.content).map((content,i)=>({id:`${e.id}:view:${i}`,content,createdAt:e.created_at||new Date().toISOString(),eventId:e.id,sessionId})));
        await updateRun(id,r=>{
          r.trace.push(...events.map(e=>({id:e.id,time:e.created_at||new Date().toISOString(),type:`ui.${e.type}`,title:`Presentation: ${e.type}`,detail:JSON.stringify(e).slice(0,24000)})));
          if(views.length) r.visuals=views;
        });
        if (!views.length) throw Error('The harness produced no supported figure program; inspect its logbook');
        return await getRun(id);
      }
      await new Promise(resolve=>setTimeout(resolve,1500));
    }
    if(sessionId) await forge(`/sessions/${sessionId}/cancel`,{});
    throw Error('Presentation generation timed out');
  } finally { await updateRun(id,r=>{r.presentationPending=false;}); }
}
