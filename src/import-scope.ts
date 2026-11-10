import {normalizeArabic} from './automatic-planning.js';

function collegeLocation(name:string){
  return normalizeArabic(name)
    .replace(/^(?:ال)?كليه\s+التقنيه(?:\s+ب(?=\S)|\s+|$)/,'')
    .replace(/^(?:ال)?كليه(?:\s+|$)/,'').trim();
}
export function isGenericCollege(name:string){return !collegeLocation(name);}
/** Equivalent institutional prefixes are accepted only when the remaining location matches exactly. */
export function sameCollege(a:string,b:string){
  if(normalizeArabic(a)===normalizeArabic(b))return true;
  const location=collegeLocation(a);
  return !!location&&location===collegeLocation(b);
}
