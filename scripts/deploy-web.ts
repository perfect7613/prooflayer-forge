import { config } from 'dotenv';
import { spawnSync } from 'node:child_process';
config({path:'.env',quiet:true});
for(const key of ['PROOFLAYER_API_URL','PROOFLAYER_ACCESS_TOKEN']) {
  const value=process.env[key];
  if(!value)throw Error(`Set ${key} in .env`);
  const result=spawnSync('vercel',['env','add',key,'production','--force','--yes'],{input:value,encoding:'utf8'});
  if(result.status!==0)throw Error(`Vercel could not configure ${key}; inspect project access`);
  console.log(`Configured server-only ${key}`);
}
const result=spawnSync('vercel',['deploy','--prod','--yes'],{stdio:'inherit'});
if(result.status!==0)process.exit(result.status||1);
