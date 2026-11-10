import {parseCsv} from './importer.js';

/** Local exports vary by Excel locale. Decode before parsing; never repair lost identifiers. */
export function readSmartCsv(bytes:Buffer){
  if(!bytes.length||bytes.length>20*1024*1024)throw new Error('CSV must be 1 byte to 20 MiB');
  let encoding='utf-8',text:string;
  if(bytes[0]===0xff&&bytes[1]===0xfe)encoding='utf-16le';
  else if(bytes[0]===0xfe&&bytes[1]===0xff)encoding='utf-16be';
  try{text=new TextDecoder(encoding,{fatal:true}).decode(bytes);}
  catch{
    if(encoding!=='utf-8')throw new Error('Invalid Unicode CSV');
    encoding='windows-1256';text=new TextDecoder(encoding,{fatal:true}).decode(bytes);
  }
  if(text.includes('\0')||text.includes('\ufffd'))throw new Error('Invalid CSV text encoding');
  text=text.replace(/^\uFEFF/,'');
  const directive=text.match(/^sep=([,;\t])\r?\n/i);
  if(directive)text=text.slice(directive[0].length);
  const candidates=(directive?[directive[1]!]:[',',';','\t']).flatMap(delimiter=>{
    try{
      const rows=parseCsv(text,delimiter);
      const widths=new Map<number,number>();
      for(const row of rows.slice(0,100))if(row.length>1)widths.set(row.length,(widths.get(row.length)??0)+1);
      const score=Math.max(0,...[...widths].map(([width,count])=>width*count));
      return [{rows,delimiter,score}];
    }catch{return [];}
  });
  candidates.sort((a,b)=>b.score-a.score);
  const selected=candidates[0];
  if(!selected)throw new Error('Malformed CSV quotes or separators');
  if(selected.rows.length>100_001)throw new Error('CSV exceeds 100000 data rows');
  if(selected.rows.some(row=>row.length>200))throw new Error('CSV exceeds 200 columns');
  return {...selected,encoding};
}
