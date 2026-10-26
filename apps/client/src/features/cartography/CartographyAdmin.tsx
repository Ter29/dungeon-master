import {useState,type FormEvent} from 'react';
import type {MapFragmentView,SharedMapSummary} from '@dnd/shared';
import {api} from '../../lib/api';
type Run=(task:()=>Promise<void>)=>Promise<void>;
export function MapAdmin({base,map,ready,storage,run,choose}:{base:string;map:SharedMapSummary|null;ready:boolean;storage:boolean;run:Run;choose:(id:string)=>void}){
 const [draft,setDraft]=useState(map),[confirm,setConfirm]=useState(false);
 function save(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget),data={name:String(f.get('name')),description:String(f.get('description')),available:f.get('available')==='on'};
 void run(async()=>{if(draft){const result=await api<{map:SharedMapSummary}>(`${base}/maps/${draft.id}`,{...data,revision:draft.revision},'PATCH');setDraft(result.map);}else{const result=await api<{map:SharedMapSummary}>(`${base}/maps`,{...data,width:Number(f.get('width')),height:Number(f.get('height'))});choose(result.map.id);}});}
 async function upload(e:FormEvent<HTMLFormElement>){e.preventDefault();if(!draft)return;const form=e.currentTarget,data=new FormData(form);data.set('revision',String(draft.revision));await run(async()=>{await api(`${base}/maps/${draft.id}/background`,data);setDraft((await api<{map:SharedMapSummary}>(`${base}/maps/${draft.id}`)).map);form.reset();});}
 return <section aria-label="Керування картою DM"><h4>{draft?'Налаштування карти · DM':'Нова карта · DM'}</h4>
 {map&&draft&&map.revision!==draft.revision&&<p role="alert">Карта змінилася. Оновіть форму перед наступним збереженням.</p>}
 {map&&<button onClick={()=>{setDraft(map);setConfirm(false);}}>Оновити форму карти</button>}
 <form key={draft?.revision??'new'} onSubmit={save}><fieldset disabled={!ready}><label>Назва карти <input name="name" required maxLength={120} defaultValue={draft?.name}/></label><p><label>Опис карти <textarea name="description" maxLength={4000} defaultValue={draft?.description}/></label></p>
 {!draft&&<p><label>Ширина полотна <input type="number" name="width" min="100" max="10000" defaultValue="2000"/></label><label>Висота полотна <input type="number" name="height" min="100" max="10000" defaultValue="1200"/></label></p>}
 <p><label><input type="checkbox" name="available" defaultChecked={draft?.available??false}/> Видати карту гравцям (разом із фоном)</label></p><button>{draft?'Зберегти карту':'Створити порожню карту'}</button></fieldset></form>
 {draft&&<><p>Фон необов’язковий. Завантажуйте саме матеріал, який плануєте показати гравцям. Розмір полотна залишається незмінним.</p>
 <form onSubmit={e=>void upload(e)}><fieldset disabled={!ready||!storage}><label>Фон карти PNG/JPG <input name="file" type="file" accept="image/png,image/jpeg" required/></label><button>Завантажити фон карти</button></fieldset></form>
 <button disabled={!ready||!map?.background} onClick={()=>void run(async()=>{await api(`${base}/maps/${draft.id}/background`,{revision:draft.revision},'DELETE');setDraft((await api<{map:SharedMapSummary}>(`${base}/maps/${draft.id}`)).map);})}>Прибрати фон карти</button>{' '}
 {!confirm?<button disabled={!ready} onClick={()=>setConfirm(true)}>Видалити карту…</button>:<p>Видалити карту та її елементи?<button disabled={!ready} onClick={()=>void run(async()=>{await api(`${base}/maps/${draft.id}`,{revision:draft.revision},'DELETE');choose('');})}>Підтвердити видалення карти</button><button onClick={()=>setConfirm(false)}>Скасувати</button></p>}
 </>}
 </section>;
}
export function FragmentAdmin({base,fragment,ready,storage,run}:{base:string;fragment:MapFragmentView;ready:boolean;storage:boolean;run:Run}){
 const [name,setName]=useState(fragment.name),[confirm,setConfirm]=useState(false);
 return <details><summary>{fragment.name} · {fragment.issued?'виданий':'приватний'} · DM</summary>
 <fieldset disabled={!ready}><label>Назва фрагмента <input maxLength={120} value={name} onChange={e=>setName(e.target.value)}/></label><button onClick={()=>void run(async()=>{await api(`${base}/fragments/${fragment.id}`,{name,revision:fragment.revision},'PATCH');})}>Перейменувати фрагмент</button>{' '}
 <button disabled={!fragment.image} onClick={()=>void run(async()=>{await api(`${base}/fragments/${fragment.id}`,{issued:!fragment.issued,revision:fragment.revision},'PATCH');})}>{fragment.issued?'Відкликати фрагмент':'Видати фрагмент гравцям'}</button>
 <form onSubmit={e=>{e.preventDefault();const form=e.currentTarget,data=new FormData(form);data.set('revision',String(fragment.revision));void run(async()=>{await api(`${base}/fragments/${fragment.id}/image`,data);form.reset();});}}><fieldset disabled={!storage||fragment.issued}><label>Зображення фрагмента PNG/JPG <input name="file" type="file" accept="image/png,image/jpeg" required/></label><button>Завантажити зображення фрагмента</button></fieldset></form>
 {fragment.issued&&<p>Перед заміною зображення відкличте фрагмент.</p>}
 {!confirm?<button onClick={()=>setConfirm(true)}>Видалити фрагмент…</button>:<><p>Видалити фрагмент і всі його розміщення?</p><button onClick={()=>void run(async()=>{await api(`${base}/fragments/${fragment.id}`,{revision:fragment.revision},'DELETE');})}>Підтвердити видалення фрагмента</button><button onClick={()=>setConfirm(false)}>Скасувати</button></>}
 </fieldset></details>;
}
