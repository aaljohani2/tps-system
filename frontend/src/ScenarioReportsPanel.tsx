export default function ScenarioReportsPanel({scenarioId}:{scenarioId:string}){
 const reports=[['instructors','جداول المدربين','جدول أسبوعي مستقل لكل مدرب'],
  ['trainees','جداول المتدربين','حسب المستوى ومجموعة المتدربين والشعب المشتركة'],['rooms','جداول القاعات','جدول أسبوعي مستقل لكل قاعة']];
 return <section className="panel" aria-label="تقارير السيناريو Excel وPDF"><h3>تقارير هذا السيناريو</h3>
  <p className="hint">تتضمن حالة السيناريو والمقررات غير المغطاة والإسناد الخارجي المعلق، مع أسماء المقررات والأوقات الدقيقة.</p>
  <table><thead><tr><th>التقرير</th><th>المحتوى</th><th>Excel</th><th>PDF</th></tr></thead><tbody>
   {reports.map(([kind,title,description])=><tr key={kind}><td>{title}</td><td>{description}</td>
    <td><a href={'/api/v1/scenarios/'+scenarioId+'/reports/'+kind+'/xlsx'} aria-label={title+' Excel'}>تنزيل Excel</a></td>
    <td><a href={'/api/v1/scenarios/'+scenarioId+'/reports/'+kind+'/pdf'} aria-label={title+' PDF'}>تنزيل PDF</a></td></tr>)}
  </tbody></table></section>;
}
