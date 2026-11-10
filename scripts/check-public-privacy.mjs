#!/usr/bin/env node
/**
 * Privacy guard for PUBLIC repository text. Reports locations only; never prints matched data.
 * This is not a secret-history scanner or review of attachments, compiled binaries, git objects.
 */
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const entries=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8',maxBuffer:5_000_000})
 .split('\0').filter(Boolean);
const include=/\.(?:md|txt|ts|tsx|js|mjs|cjs|json|html|yml|yaml|csv|py|ps1|sql)$/i;
const forbidden=[
 ['identifying institutional text',/(?:رجال\s*ألمع|تقنية\s*الأعمال|الإدارة\s*المكتبية)/u],
 ['identifying staff text',/(?:الجهني|أنس|فهد|محمد|عيسى|عبدالله|\b(?:Abdullah|Fahad|Mohammed|Anas)\b)/iu],
 ['local user/workstation path',/[A-Z]:\\(?:Users|tps_system)(?:\\|\/|$)/i],
 ['personal email address',/[A-Z0-9._%+-]+@(?:gmail|hotmail|outlook)\.com\b/i],
 ['private key block',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/]
];
let scanned=0,failures=0;
for(const path of entries){
 if(!include.test(path)||path==='scripts/check-public-privacy.mjs')continue;
 const data=readFileSync(new URL('../'+path,import.meta.url));
 if(data.includes(0)||data.length>1_500_000)continue;
 const lines=data.toString('utf8').split(/\r?\n/);
 scanned++;
 for(let index=0;index<lines.length;index++){
  for(const [label,re] of forbidden){
   re.lastIndex=0;
   if(re.test(lines[index])){
    console.error('PRIVACY_BLOCK '+path+':'+(index+1)+' ['+label+']');
    failures++;
   }
  }
 }
}
if(failures){
 console.error('Public privacy guard failed: '+failures+' finding(s). Review locally; do not put sensitive text in CI comments.');
 process.exitCode=1;
}else console.log('Public text privacy guard passed for '+scanned+' tracked text files; history and binary data not assessed.');
