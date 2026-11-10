import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';

test('smart import previews localized files, requires capacity decisions and confirms generic college scope',
  {skip:process.env.TPS_DB_INTEGRATION!=='1'},async()=>{
    const {createApp}=await import('../src/api/create-app.js');
    const {pool}=await import('../src/api/database.js');
    const argon2=(await import('argon2')).default;
    const app=await createApp(),suffix=randomUUID().slice(0,8),password=randomUUID();
    try{
      await pool.query('INSERT INTO users(username,password_hash,role) VALUES($1,$2,$3)',
        ['smart_'+suffix,await argon2.hash(password),'SYSTEM_ADMIN']);
      const login=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{username:'smart_'+suffix,password}});
      const cookie=String(login.headers['set-cookie']).split(';')[0]!;
      const me=await app.inject({url:'/api/v1/auth/me',headers:{cookie}});
      const headers={cookie,'x-csrf-token':me.json().csrfToken};
      const post=async(path:string,payload:Record<string,unknown>)=>{
        const r=await app.inject({method:'POST',url:'/api/v1'+path,headers,payload});
        assert.equal(r.statusCode,200,r.body);return r.json();
      };
      const institution=await post('/institutions',{name:'Synthetic smart import '+suffix});
      const college=await post('/colleges',{institutionId:institution.id,name:'الكلية التقنية بمدينة المثال'});
      const department=await post('/departments',{collegeId:college.id,name:'قسم اختبار الاستيراد'});
      const term=await post('/terms',{collegeId:college.id,code:'T-'+suffix,label:'فصل اصطناعي',startsOn:'2027-01-01',endsOn:'2027-06-30'});
      const scope='?departmentId='+department.id+'&collegeId='+college.id;
      const malformed=await app.inject({method:'POST',url:'/api/v1/raiyat-resources/preview'+scope,
        headers:{...headers,'content-type':'text/csv'},payload:Buffer.from('a,b\n"broken')});
      assert.equal(malformed.statusCode,400,'Invalid files return a useful validation error');
      const bytes=Buffer.from('الوحدة التدريبية;رمز القاعة;وصف القاعة;السعة\nكلية مدينة المثال;0001;قاعة تجريبية;40\nكلية مدينة المثال;0001;قاعة تجريبية;50');
      const preview=await app.inject({method:'POST',url:'/api/v1/raiyat-resources/preview'+scope,
        headers:{...headers,'content-type':'text/csv'},payload:bytes});
      assert.equal(preview.statusCode,200,preview.body);
      assert.equal(preview.json().rooms[0].capacity,null);
      assert.deepEqual(preview.json().rooms[0].capacityCandidates,[40,50]);
      const proof=(name:string,buffer:Buffer)=>({name,base64:buffer.toString('base64'),sha256:createHash('sha256').update(buffer).digest('hex')});
      const roomPayload={...proof('renamed.csv',bytes),departmentId:department.id,collegeId:college.id,importRooms:true};
      const refused=await app.inject({method:'POST',url:'/api/v1/raiyat-resources/commit',headers,payload:roomPayload});
      assert.equal(refused.statusCode,409);
      assert.equal((await pool.query('SELECT id FROM rooms WHERE college_id=$1',[college.id])).rowCount,0);
      const accepted=await post('/raiyat-resources/commit',{...roomPayload,roomDecisions:{'0001':{capacity:40,type:'CLASSROOM'}}});
      assert.equal(accepted.importedRooms,1);
      assert.equal((await post('/raiyat-resources/commit',{...roomPayload,roomDecisions:{'0001':{capacity:40,type:'CLASSROOM'}}})).importedRooms,0);
      const traineeText='الوحدة التدريبية;القسم;الرقم التدريبي;المقرر\nكلية مدينة المثال;قسم اختبار الاستيراد;0001;C-101\nكلية مدينة المثال;قسم اختبار الاستيراد;0001;C-101\nكلية مدينة المثال;قسم اختبار الاستيراد;1;C-101';
      const traineeBytes=Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from(traineeText,'utf16le')]);
      const history=await app.inject({method:'POST',url:'/api/v1/automatic-planning/history/preview?departmentId='+department.id+
        '&courseLevels='+encodeURIComponent(JSON.stringify({'C-101':1})),headers:{...headers,'content-type':'text/csv'},payload:traineeBytes});
      assert.equal(history.statusCode,200,history.body);
      assert.equal(history.json().counts[1],2,'Identifiers retain leading zeros; repeated meetings are deduplicated');
      assert.ok(!history.body.includes('0001'));
      const plan=Buffer.from('الكلية;القسم;المقرر;اسم المقرر;المستوى;مح;عم\nالكلية التقنية;قسم اختبار الاستيراد;C-101;مقرر تجريبي;الأول;2;0');
      const payload={departmentId:department.id,termId:term.id,newProgramCode:'SMART-'+suffix,newProgramName:'برنامج اختبار',
        planCode:'PLAN-'+suffix,versionLabel:'نسخة اختبار',scenarioName:'اختبار الاستيراد',plan:proof('unrelated-name.csv',plan),
        trainees:proof('another-name.csv',traineeBytes),sourceKind:'COURSE_REGISTRATIONS',
        capacities:{remoteTheory:100,onsiteTheory:40,practical:30,mixed:30}};
      const path='/api/v1/automatic-planning/full-import?departmentId='+department.id;
      const generic=await app.inject({method:'POST',url:path,headers,payload});
      assert.equal(generic.statusCode,409,generic.body);
      const saved=await post(path.slice('/api/v1'.length),{...payload,confirmGenericCollege:true});
      assert.equal(saved.demandRecords,1);assert.equal(saved.blocks,1);
      const replay=await post(path.slice('/api/v1'.length),{...payload,confirmGenericCollege:true});
      assert.equal(replay.replayed,true);assert.equal(replay.scenarioId,saved.scenarioId);
      const otherPlan=Buffer.from(plan.toString().replace('الكلية التقنية;','الكلية التقنية بمدينة أخرى;'));
      const denied=await app.inject({method:'POST',url:path,headers,payload:{...payload,confirmGenericCollege:true,plan:proof('other.csv',otherPlan)}});
      assert.equal(denied.statusCode,409,'Confirmation cannot override a different specific college');
    }finally{await app.close();await pool.end();}
  });
