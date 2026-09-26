import { createLibrary, defineComponent, createParser } from '@openuidev/react-lang';
import { z } from 'zod/v4';
const schemas = {
  Stack:z.object({children:z.array(z.any())}), Card:z.object({children:z.array(z.any())}),
  CardHeader:z.object({title:z.string(),subtitle:z.string().optional()}), TextContent:z.object({text:z.string()}),
  EvidenceChart:z.object({evidenceId:z.string(),arrayPath:z.string(),xField:z.string(),yField:z.string(),groupField:z.string(),title:z.string(),xLabel:z.string(),yLabel:z.string()}),
  EvidenceTable:z.object({evidenceId:z.string(),arrayPath:z.string(),columns:z.array(z.string()).max(12),title:z.string()}),
};
const library = createLibrary({root:'Stack',components:Object.entries(schemas).map(([name,props])=>defineComponent({name,props,description:name,component:()=>null}))});
export function validateView(content:string):string[] {
  try { const result=createParser(library.toJSONSchema(), library.root).parse(content); return [...result.meta.errors.map(e=>JSON.stringify(e)), ...result.meta.unresolved.map(e=>`Unresolved reference: ${e}`)]; } catch { return ['Invalid OpenUI program']; }
}
