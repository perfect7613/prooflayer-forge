"use client";
import { Component, createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { createLibrary, defineComponent, Renderer } from '@openuidev/react-lang';
import { z } from 'zod/v4';
import type { Evidence, Run } from '@/lib/types';
import { executionRows, safeProgram } from '@/lib/visuals';
import { validateView } from "@/lib/ui-validation";
import { chartTransform, projectPoint } from '@/lib/chart-geometry';
import type { Vec2 } from 'math';
const EvidenceContext = createContext<Evidence[]>([]);
const colors = ['#ac482f', '#245b54', '#977535', '#695b8c', '#54687d'];
function Chart({ evidenceId, arrayPath, xField, yField, groupField, title, xLabel, yLabel }: { evidenceId: string; arrayPath: string; xField: string; yField: string; groupField: string; title: string; xLabel: string; yLabel: string }) {
  const evidence = useContext(EvidenceContext);
  const rows = executionRows(evidence, evidenceId, arrayPath);
  const groups = [...new Set(rows.map(r => groupField ? String(r[groupField]) : 'All measurements'))].slice(0, 20);
  const [hidden, setHidden] = useState<string[]>([]);
  const [hover, setHover] = useState('');
  const points = rows.filter(r => typeof r[xField] === 'number' && Number.isFinite(r[xField]) && typeof r[yField] === 'number' && Number.isFinite(r[yField]));
  if (!points.length) return <p className="figure-notice">No finite measurements available for {title}. Missing values are not plotted.</p>;
  const xs = points.map(r => r[xField] as number), ys = points.map(r => r[yField] as number);
  const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(0, ...ys), ymax = Math.max(...ys);
  const transform = chartTransform(xmin, xmax, ymin, ymax);
  const scratch: Vec2 = [0, 0];
  return <figure className="measured-figure">
    <figcaption><span className="eyebrow">EXECUTED MEASUREMENTS</span><h3>{title}</h3></figcaption>
    <div className="figure-legend">{groups.map((g, i) => <button key={g} aria-pressed={!hidden.includes(g)} onClick={() => setHidden(h => h.includes(g) ? h.filter(x => x !== g) : [...h, g])}><i style={{background: colors[i % colors.length]}} />{groupField ? `${groupField} = ${g}` : g}</button>)}</div>
    <svg viewBox="0 0 700 355" role="img" aria-label={`${title}. ${xLabel} versus ${yLabel}. Exact values in the data table below.`}>
      {[0, .25, .5, .75, 1].map(t => { const y = 290 - t * 260; return <g key={t}><line x1="70" x2="650" y1={y} y2={y} stroke="#e0ddd3"/><text x="60" y={y + 4} textAnchor="end">{(ymin + t * (ymax - ymin)).toLocaleString(undefined, {maximumFractionDigits: 4})}</text></g>; })}
      {[0, .25, .5, .75, 1].map(t => <text key={t} x={70 + t * 580} y="314" textAnchor="middle">{(xmin + t * (xmax - xmin)).toLocaleString(undefined, {maximumFractionDigits: 5})}</text>)}
      <text x="360" y="346" textAnchor="middle">{xLabel}</text><text transform="translate(15 170) rotate(-90)" textAnchor="middle">{yLabel}</text>
      {points.map((r, i) => { const group = groupField ? String(r[groupField]) : 'All measurements'; if (hidden.includes(group)) return null; projectPoint(scratch, r[xField] as number, r[yField] as number, transform); const label = `${groupField ? groupField + '=' + group + ', ' : ''}${xField}=${r[xField]}, ${yField}=${r[yField]}`; return <circle key={i} cx={scratch[0]} cy={scratch[1]} r="5" fill={colors[groups.indexOf(group) % colors.length]} stroke="#fffdf7" strokeWidth="1.5" tabIndex={0} aria-label={label} onFocus={() => setHover(label)} onMouseEnter={() => setHover(label)}><title>{label}</title></circle>; })}
    </svg>
    <p className="figure-readout" aria-live="polite">{hover || 'Hover or focus a point to inspect its value. Toggle a series above.'}</p>
    <p className="figure-source">{points.length}/{rows.length} rows plotted · Source {evidenceId.slice(0, 8)} · Null values omitted</p>
    <details><summary>Inspect exact data</summary><DataTable rows={rows} columns={[...new Set([groupField, xField, yField].filter(Boolean))]} /></details>
  </figure>;
}
function DataTable({rows, columns}: { rows: Record<string, unknown>[]; columns: string[] }) {
  return <div className="measurement-table"><table><thead><tr>{columns.map(c => <th key={c}>{c}</th>)}</tr></thead><tbody>{rows.slice(0, 1000).map((r, i) => <tr key={i}>{columns.map(c => <td key={c}>{r[c] == null ? 'Not reached / missing' : typeof r[c] === 'object' ? JSON.stringify(r[c]) : String(r[c])}</td>)}</tr>)}</tbody></table></div>;
}
const ChartComponent = defineComponent({name: 'EvidenceChart', description: 'Plot recorded sandbox JSON, without model-authored numeric data', props: z.object({evidenceId:z.string(), arrayPath:z.string(), xField:z.string(), yField:z.string(), groupField:z.string(), title:z.string(), xLabel:z.string(), yLabel:z.string()}), component: ({props}) => <Chart {...props}/>});
const TableComponent = defineComponent({name:'EvidenceTable', description:'Recorded measurement rows', props:z.object({evidenceId:z.string(), arrayPath:z.string(), columns:z.array(z.string()).max(12), title:z.string()}), component: ({props}) => { const evidence=useContext(EvidenceContext); return <section className="measured-figure"><h3>{props.title}</h3><DataTable rows={executionRows(evidence,props.evidenceId,props.arrayPath)} columns={props.columns}/></section>; }});
const TextComponent = defineComponent({name:'TextContent', description:'Plain text only',props:z.object({text:z.string()}),component:({props})=><p>{props.text}</p>});
const HeaderComponent = defineComponent({name:'CardHeader',description:'Figure section heading',props:z.object({title:z.string(),subtitle:z.string().optional()}),component:({props})=><header><h3>{props.title}</h3><p>{props.subtitle}</p></header>});
const CardComponent = defineComponent({name:'Card',description:'Figure card',props:z.object({children:z.array(z.any())}),component:({props,renderNode})=><section className="generated-card">{renderNode(props.children)}</section>});
const StackComponent = defineComponent({name:'Stack',description:'Vertical research figures',props:z.object({children:z.array(z.any())}),component:({props,renderNode})=><div className="generated-stack">{renderNode(props.children)}</div>});
const library = createLibrary({root:'Stack',components:[StackComponent,CardComponent,HeaderComponent,TextComponent,ChartComponent,TableComponent]});
class ViewBoundary extends Component<{children:ReactNode},{failed:boolean}> { state={failed:false}; static getDerivedStateFromError(){return {failed:true};} render(){return this.state.failed?<p className="figure-notice">This generated view could not be rendered. The original evidence and report remain available.</p>:this.props.children;} }
export function GeneratedView({run}:{run:Run}) {
  const views=useMemo(()=>(run.visuals||[]).filter(v=>safeProgram(v.content)),[run.visuals]);
  return <EvidenceContext.Provider value={run.evidence}><div className="generated-stack"><div className="figure-notice">TrueForge selects the layout. Plotted values come directly from saved sandbox output. Figures do not override claim assessments.</div>{views.map(v=><ViewBoundary key={v.id}>{validateView(v.content).length ? <p className="figure-notice">This generated view has an incomplete component. Regenerate figures to repair the presentation. Recorded evidence is unchanged.</p> : <Renderer response={v.content} library={library} isStreaming={false} publishObservability={false}/>}<details className="view-source"><summary>View generation record</summary><p>Session {v.sessionId} · Event {v.eventId}</p><pre>{v.content}</pre></details></ViewBoundary>)}{!views.length&&<div className="empty">Generate figures from completed execution evidence. No experiment is rerun.</div>}</div></EvidenceContext.Provider>;
}
