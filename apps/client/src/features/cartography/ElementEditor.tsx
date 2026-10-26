import {useState,type FormEvent} from 'react';
import type {MapElementView} from '@dnd/shared';
export function ElementEditor({element,dm,ready,save,remove}:{element:MapElementView;dm:boolean;ready:boolean;save:(e:MapElementView)=>Promise<MapElementView|undefined>;remove:(e:MapElementView)=>Promise<void>}){
 const [draft,setDraft]=useState(element),[confirm,setConfirm]=useState(false);
 const field=(key:string,value:unknown)=>setDraft(e=>({...e,[key]:value}));
 function submit(e:FormEvent){e.preventDefault();void save(draft).then(result=>{if(result)setDraft(result);});}
 return <section aria-label="Редактор елемента"><h4>Елемент · {element.kind}</h4>
 {draft.revision!==element.revision&&<p role="alert">Інший учасник змінив елемент. Ваше збереження отримає конфлікт; спочатку оновіть форму.</p>}
 <button onClick={()=>{setDraft(element);setConfirm(false);}}>Оновити форму елемента</button>
 <form onSubmit={submit}><fieldset disabled={!ready||(!dm&&element.locked)}>
 <p><label>Текст елемента <textarea maxLength={1000} value={draft.text} onChange={e=>field('text',e.target.value)}/></label></p>
 <label>Колір елемента <input type="color" value={draft.color} onChange={e=>field('color',e.target.value)}/></label>{' '}
 <label>Елемент X <input type="number" min="0" step="any" value={draft.x} onChange={e=>field('x',Number(e.target.value))}/></label>{' '}
 <label>Елемент Y <input type="number" min="0" step="any" value={draft.y} onChange={e=>field('y',Number(e.target.value))}/></label>
 {element.kind==='FRAGMENT'&&<p><label>Масштаб фрагмента <input type="number" min=".05" max="10" step=".05" value={draft.scale} onChange={e=>field('scale',Number(e.target.value))}/></label>{' '}<label>Обертання фрагмента <input type="number" min="-360" max="360" value={draft.rotation} onChange={e=>field('rotation',Number(e.target.value))}/></label></p>}
 {draft.points.length>0&&<details><summary>Вершини лінії / контуру</summary><div style={{maxHeight:250,overflow:'auto'}}>{draft.points.map((p,i)=><p key={i}><label>Точка {i+1} X <input type="number" min="0" step="any" value={p.x} onChange={e=>field('points',draft.points.map((p,j)=>i===j?{...p,x:Number(e.target.value)}:p))}/></label><label>Точка {i+1} Y <input type="number" min="0" step="any" value={p.y} onChange={e=>field('points',draft.points.map((p,j)=>i===j?{...p,y:Number(e.target.value)}:p))}/></label><button type="button" onClick={()=>field('points',draft.points.filter((_,j)=>i!==j))}>Прибрати вершину {i+1}</button></p>)}</div><button type="button" disabled={draft.points.length>=128} onClick={()=>field('points',[...draft.points,{x:0,y:0}])}>Додати вершину</button></details>}
 {dm&&<p><label><input type="checkbox" checked={draft.locked} onChange={e=>field('locked',e.target.checked)}/> Заблокувати для гравців</label></p>}
 <button>Зберегти елемент</button>{' '}{!confirm?<button type="button" onClick={()=>setConfirm(true)}>Видалити елемент…</button>:<><button type="button" onClick={()=>void remove(draft)}>Підтвердити видалення елемента</button><button type="button" onClick={()=>setConfirm(false)}>Скасувати</button></>}
 </fieldset></form>{element.locked&&!dm&&<p>Елемент заблокований DM.</p>}
 </section>;
}
