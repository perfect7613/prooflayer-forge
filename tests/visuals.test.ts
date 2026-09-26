import { it, expect } from 'vitest';
import { safeProgram, extractViews, executionRows } from '../src/lib/visuals';
import { chartTransform, projectPoint } from '../src/lib/chart-geometry';
import { reviewInput } from '../server/jev';
import type { Evidence, Claim } from '../src/lib/types';
const evidence:Evidence={id:'e',title:'Result',kind:'python',status:'passed',summary:'',hash:'h',createdAt:'',content:JSON.stringify({stdout:JSON.stringify({rows:[{seed:0,t2:null},{seed:1,t2:20000}],late:'x'.repeat(10000)+'LAST_SEED'})}),metadata:{sandboxId:'sb-test'}};
it('reads only genuine successful execution rows and preserves missing values',()=>{
  expect(executionRows([evidence],'e','rows')[0].t2).toBeNull();
  expect(executionRows([{...evidence,status:'failed'}],'e','rows')).toEqual([]);
  expect(executionRows([evidence],'e','__proto__')).toEqual([]);
  expect(executionRows([evidence],'invented','rows')).toEqual([]);
});
it('rejects interactive/network components and retains only bounded read-only programs',()=>{
  const program='root = Stack([TextContent("Result"), EvidenceChart("e", "rows", "seed", "t2", "", "Title", "Seed", "Steps")])';
  expect(safeProgram(program)).toBe(true);
  expect(extractViews('```openui\n'+program+'\n```')).toEqual([program]);
  for(const unsafe of ['root = Stack([Image("x", "https://evil.test")])','root = Stack([Query("tool")])','root = Stack([@OpenUrl("x")])','root = Stack([Button("Run")])'])expect(safeProgram(unsafe)).toBe(false);
});
it('maps plot coordinates with alias-safe math and handles constant ranges',()=>{
  const t=chartTransform(0,10,0,100);
  expect(projectPoint([0,0],0,0,t)).toEqual([70,290]);
  expect(projectPoint([0,0],10,100,t)).toEqual([650,30]);
  expect(projectPoint([0,0],3,4,chartTransform(3,3,4,4)).every(Number.isFinite)).toBe(true);
  expect(()=>chartTransform(NaN,1,0,1)).toThrow();
});
it('does not truncate later measurements or omit associated implementation from Jev',()=>{
  const code={...evidence,id:'code',content:'print(results)',metadata:{}};
  const result={...evidence,metadata:{...evidence.metadata,sourceEvidenceId:'code'}};
  const claim={id:'c',text:'All seeds',kind:'empirical',scope:'paper_subset',evidenceIds:['e']} as Claim;
  const input=reviewInput([claim],[result,code]);
  expect(input[0].evidence[0].content).toContain('LAST_SEED');
  expect(input[0].evidence[0].implementation?.content).toBe('print(results)');
  expect(input[0].evidence[0].truncated).toBe(false);
});
it('rejects a generated chart with a missing axis argument', async()=>{
  const {validateView}=await import('../src/lib/ui-validation');
  expect(validateView('root = Stack([EvidenceChart("e", "rows", "seed", "t2", "", "Title", "Seed", "Steps")])')).toEqual([]);
  expect(validateView('root = Stack([EvidenceChart("e", "rows", "seed", "t2", "", "Title", "Seed")])').join()).toContain('missing-required');
});
