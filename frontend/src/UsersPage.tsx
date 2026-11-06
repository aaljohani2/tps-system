import {useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api,post,type Auth,type Entity} from './api';
type User={id:string;username:string;role:string;college_id:string|null;department_id:string|null;active:boolean};
const roles=['COLLEGE_ADMIN','DEPARTMENT_HEAD','SCHEDULER','REVIEWER','APPROVER','TRAINER','VIEWER'];
const names:Record<string,string>={COLLEGE_ADMIN:'مدير كلية',DEPARTMENT_HEAD:'رئيس قسم',SCHEDULER:'مسؤول الجداول',
  REVIEWER:'مراجع',APPROVER:'معتمد',TRAINER:'مدرب',VIEWER:'مشاهد',SYSTEM_ADMIN:'مدير النظام'};
export default function UsersPage({auth,notify}:{auth:Auth;notify:(v:string)=>void}){
  const qc=useQueryClient(),admin=auth.role==='SYSTEM_ADMIN';
  const [collegeId,setCollegeId]=useState(auth.collegeId??''),[departmentId,setDepartmentId]=useState(''),
    [username,setUsername]=useState(''),[password,setPassword]=useState(''),
    [role,setRole]=useState('VIEWER'),[busy,setBusy]=useState(false);
  const users=useQuery({queryKey:['users'],queryFn:()=>api<User[]>('/users')});
  const colleges=useQuery({queryKey:['colleges'],queryFn:()=>api<Entity[]>('/colleges')});
  const departments=useQuery({queryKey:['departments',collegeId],
    queryFn:()=>api<Entity[]>('/departments?collegeId='+collegeId),enabled:!!collegeId});
  async function run(task:()=>Promise<unknown>){
    setBusy(true);
    try{await task();notify('تم تحديث بيانات الحساب');await qc.invalidateQueries({queryKey:['users']});}
    catch(e){notify('تعذر تحديث الحساب: '+String(e instanceof Error?e.message:e));}
    finally{setBusy(false);}
  }
  return <section className="panel">
    <h2>إدارة حسابات المستخدمين والصلاحيات</h2>
    <p className="hint">تنطبق الصلاحيات على نطاق الكلية والقسم. لا يمكن لمدير كلية إنشاء مدير نظام أو تعديل مدير كلية آخر. عند تعطيل الحساب أو تعديل نطاقه تُلغى جلساته الحالية.</p>
    <details><summary>إنشاء حساب محلي</summary>
      <div className="form-grid">
        <label>اسم المستخدم<input autoComplete="off" value={username} onChange={e=>setUsername(e.target.value)}/></label>
        <label>كلمة مرور أولية (16 حرفًا على الأقل)<input type="password" autoComplete="new-password" value={password}
          onChange={e=>setPassword(e.target.value)}/></label>
        <label>الدور<select value={role} onChange={e=>setRole(e.target.value)}>
          {(admin?['SYSTEM_ADMIN',...roles]:roles.filter(x=>x!=='COLLEGE_ADMIN')).map(r=><option key={r} value={r}>{names[r]}</option>)}
        </select></label>
        <label>الكلية<select value={collegeId} disabled={!admin||role==='SYSTEM_ADMIN'}
          onChange={e=>{setCollegeId(e.target.value);setDepartmentId('');}}><option value="">اختر كلية</option>
          {(colleges.data??[]).map(x=><option value={x.id} key={x.id}>{String(x.name)}</option>)}</select></label>
        <label>القسم (اختياري)<select value={departmentId} onChange={e=>setDepartmentId(e.target.value)} disabled={role==='SYSTEM_ADMIN'}>
          <option value="">نطاق الكلية</option>{(departments.data??[]).map(x=><option value={x.id} key={x.id}>{String(x.name)}</option>)}
        </select></label>
        <button className="primary" disabled={busy||password.length<16||!username||(!collegeId&&role!=='SYSTEM_ADMIN')}
          onClick={()=>run(async()=>{await post('/users',{username,password,role,
            collegeId:role==='SYSTEM_ADMIN'?null:collegeId,departmentId:role==='SYSTEM_ADMIN'?null:departmentId||null});
            setPassword('');setUsername('');
          })}>إضافة الحساب</button>
      </div>
    </details>
    <h3>الحسابات الحالية</h3>
    <div className="table-wrap"><table><thead><tr><th>المستخدم</th><th>الدور</th><th>الكلية</th><th>القسم</th><th>الحالة</th><th>الإجراء</th></tr></thead>
      <tbody>{(users.data??[]).map(u=><tr key={u.id}>
        <td>{u.username}</td><td>{names[u.role]??u.role}</td><td>{u.college_id??'النظام'}</td><td>{u.department_id??'—'}</td>
        <td>{u.active?'نشط':'معطل'}</td><td><button disabled={busy||u.id===auth.id||(auth.role==='COLLEGE_ADMIN'&&['SYSTEM_ADMIN','COLLEGE_ADMIN'].includes(u.role))}
          onClick={()=>run(()=>api('/users/'+u.id,{method:'PATCH',body:JSON.stringify({active:!u.active})}))}>
          {u.active?'تعطيل':'تفعيل'}</button></td></tr>)}</tbody></table></div>
    <p className="hint">إعادة تعيين كلمة المرور وتغيير نطاق الحساب متاحتان من API للمخولين؛ تستلزمان إجراءً إداريًا موثقًا. لا تظهر كلمات المرور أو بصماتها في هذا الجدول.</p>
  </section>;
}
