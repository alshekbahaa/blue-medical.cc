import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore, doc, getDoc, getDocs, setDoc, deleteDoc, collection, query, orderBy, limit, startAfter, writeBatch } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const $ = id => document.getElementById(id);
const show = (id, yes=true) => $(id).classList.toggle('hidden', !yes);
let toastTimer;
function toast(message, error=false) { const el=$('toast'); el.textContent=message; el.classList.toggle('error',error); show('toast'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>show('toast',false),6500); }
function token() { const bytes=new Uint8Array(32); crypto.getRandomValues(bytes); return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''); }
function validToken(x){ return /^[A-Za-z0-9_-]{43}$/.test(x || ''); }
function driveLink(value) { try { const u=new URL(String(value).trim()); return u.protocol==='https:' && ['drive.google.com','docs.google.com'].includes(u.hostname) && u.username==='' && u.password==='' && u.pathname!=='/' ? u.href : ''; } catch { return ''; } }
function reportUrl(id){ const u=new URL(location.href); u.search=''; u.hash=''; u.searchParams.set('report',id); return u.href; }
function dateText(ms){ return Number.isFinite(Number(ms)) ? new Date(Number(ms)).toLocaleDateString('en-GB') : '—'; }
function dateInput(ms){ const d=new Date(ms); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function expiryValue(str){ if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return NaN; const [y,m,d]=str.split('-').map(Number); const dt=new Date(y,m-1,d,23,59,59,999); return dt.getFullYear()===y && dt.getMonth()===m-1 && dt.getDate()===d ? dt.getTime() : NaN; }
function defaultExpiry(){ const d=new Date(); d.setFullYear(d.getFullYear()+1); return dateInput(d.getTime()); }
function makeRecord(x){
 const r={clinic:String(x.clinic||'').trim(),patientId:String(x.patientId||'').trim(),patientName:String(x.patientName||'').trim(),age:String(x.age||'').trim(),gender:String(x.gender||'').trim(),fileUrl:driveLink(x.fileUrl),createdAt:Number(x.createdAt),expiresAt:Number(x.expiresAt)};
 if(!r.clinic || !r.patientId || !r.patientName || !r.fileUrl || !Number.isFinite(r.createdAt) || !Number.isFinite(r.expiresAt) || r.createdAt<=0 || r.expiresAt<=0 || Object.values(r).some(v=>typeof v==='string' && v.length>2000)) throw new Error('يجب توفير العيادة والهوية والاسم ورابط Google Drive صالح وتواريخ صحيحة.');
 return r;
}
function errorMessage(err){ console.error(err); if(err?.code==='permission-denied') return 'رفضت Firebase العملية. تحقق من UID المدير وقواعد Firestore وصلاحيات الحساب.'; if(err?.code?.startsWith('auth/')) return 'تعذر تسجيل الدخول. تحقق من البريد وكلمة المرور وتفعيل Email/Password في Firebase.'; return err?.message || 'حدث خطأ. تحقق من الاتصال وإعدادات Firebase.'; }
function downloadFile(name, data, type){const blob=new Blob([data],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function setBusy(el,busy){el.disabled=busy;}
const reportId=new URLSearchParams(location.search).get('report');
const configured = firebaseConfig.projectId && !firebaseConfig.projectId.includes('ضع_') && firebaseConfig.apiKey && !firebaseConfig.apiKey.includes('ضع_');
if(!configured){ $('setupNotice').textContent='النسخة جاهزة للربط: ضع إعدادات تطبيق الويب في firebase-config.js ثم طبّق خطوات ملف دليل التشغيل. تسجيل الدخول غير متاح إلى أن تكتمل الإعدادات.'; show('setupNotice'); show('loginView'); $('loginForm').querySelector('button').disabled=true; }
else {
 const app=initializeApp(firebaseConfig), auth=getAuth(app), db=getFirestore(app), reports=collection(db,'reports');
 let records=[], pageCursors=[null], pageIndex=0, lastVisible=null, hasMore=false, selected=null;
 const PAGE_SIZE=50;
 const readRecord=d=>({token:d.id,...d.data()});
 function hideMain(){['loginView','adminView','clientView','headerActions'].forEach(x=>show(x,false));}
 async function publicView(){
  hideMain(); show('clientView'); show('clientLoading'); show('clientError',false); show('clientSuccess',false);
  if(!validToken(reportId)){show('clientLoading',false);show('clientError');return;}
  try { const snap=await getDoc(doc(db,'reports',reportId)); if(!snap.exists()) throw Error('not found'); const r=snap.data(); if(!Number.isFinite(r.expiresAt) || r.expiresAt<=Date.now() || !driveLink(r.fileUrl)) throw Error('unavailable');
   for(const [id,val] of Object.entries({cClinic:r.clinic,cName:r.patientName,cId:r.patientId,cAge:r.age,cGender:r.gender,cCreated:dateText(r.createdAt),cExpiry:dateText(r.expiresAt)})) $(id).textContent=val||'—';
   $('download').href=driveLink(r.fileUrl);show('clientSuccess');
  } catch(e){console.error(e);show('clientError');} finally {show('clientLoading',false);}
 }
 function resetForm(){ $('reportForm').reset(); $('editToken').value=''; $('clinic').value='Blue Medical Field Complex'; $('expiry').value=defaultExpiry(); $('formTitle').textContent='إضافة تقرير'; show('cancelEdit',false); }
 function el(tag,text){const node=document.createElement(tag); node.textContent=text;return node;}
 function draw(){
  const find=$('search').value.trim().toLowerCase(), list=records.filter(r=>[r.patientName,r.patientId,r.clinic].some(v=>String(v||'').toLowerCase().includes(find))), now=Date.now();
  $('total').textContent=records.length; $('active').textContent=records.filter(x=>x.expiresAt>now).length; $('expired').textContent=records.filter(x=>x.expiresAt<=now).length; $('soon').textContent=records.filter(x=>x.expiresAt>now&&x.expiresAt-now<=604800000).length;
  const body=$('records');body.replaceChildren();show('empty',list.length===0);
  for(const r of list){const tr=el('tr',''), status=el('span',r.expiresAt>now?'نشط':'منتهي'); status.className='badge'+(r.expiresAt>now?'':' expired'); const td=el('td','');td.append(status);tr.append(td,el('td',r.patientName||'—'),el('td',r.patientId||'—'),el('td',dateText(r.expiresAt)));const act=el('td','');
   for(const [label,fn] of [['QR',()=>openQR(r)],['تعديل',()=>edit(r)],['حذف',()=>remove(r)]]){const b=el('button',label);b.className=label==='حذف'?'danger':'secondary';b.addEventListener('click',fn);act.append(b);}tr.append(act);body.append(tr);
  }
  $('pageLabel').textContent=`الصفحة ${pageIndex+1} — الإحصاءات والبحث لهذه الصفحة فقط`;
  $('prev').disabled=pageIndex===0; $('next').disabled=!hasMore;
 }
 async function loadPage(){
   const parts=[orderBy('createdAt','desc')]; if(pageCursors[pageIndex])parts.push(startAfter(pageCursors[pageIndex])); parts.push(limit(PAGE_SIZE+1));
   const snap=await getDocs(query(reports,...parts)), docs=snap.docs; hasMore=docs.length>PAGE_SIZE;const shown=docs.slice(0,PAGE_SIZE); records=shown.map(readRecord); lastVisible=shown.at(-1)||null;draw();
 }
 function edit(r){$('editToken').value=r.token; for(const [id,key] of Object.entries({clinic:'clinic',patientId:'patientId',patientName:'patientName',age:'age',gender:'gender',driveUrl:'fileUrl'})) $(id).value=r[key]||''; $('expiry').value=dateInput(r.expiresAt);$('formTitle').textContent='تعديل التقرير';show('cancelEdit');window.scrollTo({top:0,behavior:'smooth'});}
 async function remove(r){if(!confirm(`حذف تقرير ${r.patientName}؟ سيتوقف رابط QR الجديد، لكن لن يُحذف ملف Drive.`))return;try{await deleteDoc(doc(db,'reports',r.token));await loadPage();toast('تم حذف السجل وإيقاف الرابط.');}catch(e){toast(errorMessage(e),true);}}
 function openQR(r){selected=r;const link=reportUrl(r.token);$('qrUrl').value=link;$('qrPatient').textContent=`${r.patientName} — ${r.patientId}`;$('qr').replaceChildren();$('pQr').replaceChildren();try{new QRCode($('qr'),{text:link,width:220,height:220,correctLevel:QRCode.CorrectLevel.M});new QRCode($('pQr'),{text:link,width:110,height:110,correctLevel:QRCode.CorrectLevel.M});}catch(e){toast('تعذر إنشاء QR. تحقق من تحميل المكتبة.',true);return;}$('pClinic').textContent=r.clinic;$('pName').textContent=r.patientName;$('pId').textContent=r.patientId;show('qrDialog');}
 $('reportForm').addEventListener('submit',async e=>{e.preventDefault(); const button=$('saveReport');setBusy(button,true);try{const id=$('editToken').value||token();const old=records.find(r=>r.token===id);const data=makeRecord({clinic:$('clinic').value,patientId:$('patientId').value,patientName:$('patientName').value,age:$('age').value,gender:$('gender').value,fileUrl:$('driveUrl').value,createdAt:old?.createdAt||Date.now(),expiresAt:expiryValue($('expiry').value)});await setDoc(doc(db,'reports',id),data);resetForm();pageIndex=0;pageCursors=[null];await loadPage();toast('تم حفظ التقرير.');openQR({token:id,...data});}catch(err){toast(errorMessage(err),true);}finally{setBusy(button,false);}});
 $('cancelEdit').onclick=resetForm;$('search').oninput=draw;
 const nav=document.createElement('div');nav.className='row muted';nav.style.marginTop='15px';nav.innerHTML='<button id="prev" class="secondary">السابق</button><span id="pageLabel"></span><button id="next" class="secondary">التالي</button>'; $('records').closest('.table-wrap').after(nav);
 $('prev').onclick=async()=>{if(pageIndex>0){pageIndex--;try{await loadPage();}catch(e){toast(errorMessage(e),true);}}};$('next').onclick=async()=>{if(hasMore&&lastVisible){pageCursors[pageIndex+1]=lastVisible;pageIndex++;try{await loadPage();}catch(e){toast(errorMessage(e),true);}}};
 $('refresh').onclick=async()=>{try{pageIndex=0;pageCursors=[null];await loadPage();toast('تم التحديث');}catch(e){toast(errorMessage(e),true);}};
 $('closeQr').onclick=()=>show('qrDialog',false);$('qrDialog').onclick=e=>{if(e.target.id==='qrDialog')show('qrDialog',false);};$('printQr').onclick=()=>window.print();
 $('copyLink').onclick=async()=>{try{await navigator.clipboard.writeText($('qrUrl').value);toast('تم نسخ الرابط');}catch{$('qrUrl').select();toast('حدد الرابط وانسخه يدوياً.');}};
 $('pdfInput').onchange=async e=>{const file=e.target.files[0];e.target.value='';if(!file||!selected)return;try{if(!window.PDFLib)throw Error('مكتبة PDF غير متوفرة.');const pdf=await PDFLib.PDFDocument.load(await file.arrayBuffer());const page=pdf.getPages()[0];if(!page)throw Error('ملف PDF لا يحتوي صفحات.');const canvas=$('qr').querySelector('canvas');if(!canvas)throw Error('تعذر الحصول على صورة QR.');const img=await pdf.embedPng(canvas.toDataURL('image/png'));const size=75; const {width,height}=page.getSize();page.drawImage(img,{x:Math.max(0,width-size-30),y:Math.max(0,height-size-60),width:size,height:size});downloadFile(`report-${selected.patientId.replace(/[^a-zA-Z0-9_-]/g,'_')}.pdf`,await pdf.save(),'application/pdf');toast('تم تنزيل PDF. راجع مكان الرمز قبل رفعه إلى Drive.');}catch(err){toast(errorMessage(err),true);}};
 async function allRecords(){const snap=await getDocs(query(reports,orderBy('createdAt','desc')));return snap.docs.map(readRecord);}
 $('backup').onclick=async()=>{if(!confirm('سيتم تنزيل جميع السجلات والروابط الحساسة. احفظ النسخة في مكان آمن. متابعة؟'))return;try{const data=await allRecords();downloadFile('medical-backup.json',JSON.stringify({version:'firebase-1',exportDate:new Date().toISOString(),records:data},null,2),'application/json');toast(`تم تصدير ${data.length} سجلاً.`);}catch(e){toast(errorMessage(e),true);}};
 $('csv').onclick=async()=>{if(!confirm('سيتم تنزيل جميع بيانات المرضى وروابطهم. متابعة؟'))return;try{const data=await allRecords();const safe=v=>{let s=String(v??'');if(/^\s*[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};const rows=[['Clinic','Patient ID','Name','Age','Gender','Created','Expiry','Drive URL','QR URL'],...data.map(r=>[r.clinic,r.patientId,r.patientName,r.age,r.gender,dateText(r.createdAt),dateText(r.expiresAt),r.fileUrl,reportUrl(r.token)])];downloadFile('medical-records.csv','\ufeff'+rows.map(row=>row.map(safe).join(',')).join('\r\n'),'text/csv;charset=utf-8');toast(`تم تصدير ${data.length} سجلاً.`);}catch(e){toast(errorMessage(e),true);}};
 $('template').onclick=()=>{if(!window.XLSX)return toast('مكتبة Excel غير متوفرة.',true);const ws=XLSX.utils.aoa_to_sheet([['رقم الهوية','الاسم','العمر','رابط Drive'],['1012345678','PATIENT EXAMPLE','32 Y','https://drive.google.com/file/d/EXAMPLE/view']]);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Patients');XLSX.writeFile(wb,'patients-template.xlsx');};
 async function bulkImport(items, preserveTokens=false){
   if(!items.length)throw Error('لا توجد سجلات صالحة للاستيراد.');
   if(!confirm(`سيتم استيراد ${items.length} سجلاً. راجع البيانات وروابط Drive قبل التأكيد. متابعة؟`))return;
   let count=0,skipped=0;const seen=new Set();
   for(let start=0;start<items.length;start+=400){const batch=writeBatch(db);let n=0;for(const item of items.slice(start,start+400)){try{const data=makeRecord(item);const id=preserveTokens&&validToken(item.token)?item.token:token();if(seen.has(id)){skipped++;continue;}seen.add(id);if(preserveTokens && item.token && validToken(item.token)){const existing=await getDoc(doc(db,'reports',id));if(existing.exists()){skipped++;continue;}}batch.set(doc(db,'reports',id),data);n++;}catch{skipped++;}}if(n){await batch.commit();count+=n;}}
   pageIndex=0;pageCursors=[null];await loadPage();toast(`تم استيراد ${count}، وتخطي ${skipped} سجل غير صالح أو مكرر. إذا فشل استيراد دفعة لاحقة، فقد تكون الدفعات السابقة محفوظة.`);
 }
 $('importJson').onchange=async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;try{const parsed=JSON.parse(await file.text());const arr=Array.isArray(parsed)?parsed:parsed.records;if(!Array.isArray(arr))throw Error('صيغة النسخة غير صالحة.');await bulkImport(arr,parsed.version==='firebase-1');}catch(err){toast(errorMessage(err),true);}};
 $('importExcel').onchange=async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;try{if(!window.XLSX)throw Error('مكتبة Excel غير متوفرة.');const wb=XLSX.read(await file.arrayBuffer(),{type:'array'});const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:'',raw:false});if(rows.length<2)throw Error('استخدم نموذج Excel وأضف البيانات بعد صف العناوين.');const clinic=$('clinic').value.trim(),exp=expiryValue($('expiry').value),gender=$('gender').value,now=Date.now();const arr=rows.slice(1).filter(row=>row.some(v=>String(v).trim())).map(row=>({clinic,patientId:String(row[0]||'').trim(),patientName:String(row[1]||'').trim(),age:String(row[2]||'').trim(),fileUrl:String(row[3]||'').trim(),gender,createdAt:now,expiresAt:exp}));await bulkImport(arr);}catch(err){toast(errorMessage(err),true);}};
 $('loginForm').onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('button');setBusy(b,true);try{await signInWithEmailAndPassword(auth,$('email').value.trim(),$('password').value);$('password').value='';}catch(err){toast(errorMessage(err),true);}finally{setBusy(b,false);}};
 $('logout').onclick=()=>signOut(auth).catch(e=>toast(errorMessage(e),true));
 if(reportId!==null){publicView();}else{onAuthStateChanged(auth,async user=>{hideMain();if(user){$('adminEmail').textContent=user.email||'';show('adminView');show('headerActions');resetForm();try{pageIndex=0;pageCursors=[null];await loadPage();}catch(e){toast(errorMessage(e),true);}}else{records=[];show('loginView');}});}
}
