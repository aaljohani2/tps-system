export function clock(hours:number):string{
 const minutes=Math.round(hours*60);return String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');
}
