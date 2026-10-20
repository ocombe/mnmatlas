import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const read = file => readFile(new URL('../' + file, import.meta.url), 'utf8');
const awaitSchema = await read('marker-schema.js');
const changes = await read('changes.js');
const fields = await read('marker-fields.js');
const iconContext = vm.createContext({});
vm.runInContext(await read('icons.js'), iconContext);
const fieldChoices = vm.runInContext('({tradePaths,exitArrows})', iconContext);
const source = await read('community.js');
const wikiLinks = await read('wiki-links.js');
const app = await read('app.js');
const reviewModel = await read('review-model.js');
const reviewDesk = await read('review-desk.js');
const notices = await read('notices.js');

class Node {
  constructor(tag,value='',cls=''){
    this.tagName=tag;
    this.textContent=value;
    this.className=cls;
    this.children=[];
    this.listeners={};
    this.hidden=false;
    this.value='';
    this.open=false;
    this.dataset={};
    this.style={
      setProperty(){}
    };
    this.classList={
      add:(...xs)=>{
        this.className=[...new Set([...this.className.split(' ').filter(Boolean),...xs])].join(' ');
      },remove:(...xs)=>{
        this.className=this.className.split(' ').filter(x=>!xs.includes(x)).join(' ');
      },contains:x=>this.className.split(' ').includes(x),toggle:x=>{
        this.classList.contains(x)?this.classList.remove(x):this.classList.add(x);
      }
    };
  }
  append(...nodes){
    for(let n of nodes){
      if(typeof n==='string')n=new Node('#text',n);
      if(n.parentElement)n.remove();
      n.parentElement=this;
      this.children.push(n);
    }
  }
  replaceChildren(...nodes){
    this.children=[];
    this.append(...nodes);
  }
  get options(){
    return this._options||this.querySelectorAll('option');
  }
  set options(value){
    this._options=value;
  }
  get lastChild(){
    return this.children.at(-1);
  }
  get firstChild(){
    return this.children[0];
  }
  insertBefore(node,before){
    node.remove();
    node.parentElement=this;
    this.children.splice(this.children.indexOf(before),0,node);
  }
  closest(selector){
    for(let n=this;
    n;
    n=n.parentElement)if(n.matches(selector))return n;
    return null;
  }
  matches(selector){
    return selector.split(',').some(part=>{
      const s=part.trim();
      if(s.startsWith('.'))return this.classList.contains(s.slice(1));
      if(s.startsWith('#'))return this.id===s.slice(1);
      if(s==='[contenteditable=true]')return !!this.isContentEditable;
      if(s==='dialog[open]')return this.tagName==='dialog'&&this.open;
      return s===this.tagName;
    });
  }
  scrollIntoView(){}
  setAttribute(k,v){
    this[k]=v;
  }
  removeAttribute(k){
    delete this[k];
  }
  after(...nodes){
    const parent=this.parentElement;
    for(const n of nodes){
      if(n.parentElement)n.remove();
      n.parentElement=parent;
      parent.children.splice(parent.children.indexOf(this)+1,0,n);
    }
  }
  insertAdjacentHTML(){}
  focus(){}
  contains(n){
    for(;
    n;
    n=n.parentElement)if(n===this)return true;
    return false;
  }
  querySelector(tag){
    return this.querySelectorAll(tag)[0]||null;
  }
  addEventListener(k,fn,options){
    if(options?.once){
      const run=fn;
      fn=(...args)=>{
        this.listeners[k]=this.listeners[k].filter(f=>f!==fn);
        run(...args);
      };
    }
    (this.listeners[k]??=[]).push(fn);
  }
  fire(k){
    const e={
      target:this,stopped:false,stopImmediatePropagation(){
        this.stopped=true;
      }
    };
    for(const fn of [...this.listeners[k]||[]]){
      fn(e);
      if(e.stopped)break;
    }
  }
  removeEventListener(k,fn){
    this.listeners[k]=(this.listeners[k]||[]).filter(f=>f!==fn);
  }
  dispatchEvent(event){
    this.fire(event.type);
  }
  remove(){
    if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(n=>
    n!==this);
  }
  show(){
    this.open=true;
  }
  showModal(){
    this.open=true;
  }
  close(){
    if(!this.open)return;
    this.open=false;
    setImmediate(()=>this.fire('close'));
  }
  querySelectorAll(tag){
    if(tag.includes(' ')){
      const [first,...rest]=tag.split(' ');
      return this.querySelectorAll(first).flatMap(n=>n.querySelectorAll(rest.join(' ')));
    }
    return this.children.flatMap(n=>[...(n.matches(tag)?[n]:[]),...n.querySelectorAll(tag)]);
  }
}
const settle=async()=>{
  for(let i=0;
  i<8;
  i++)await new Promise(resolve=>setImmediate(resolve));
};
function environment(settings={},hostname='atlas.example',session=null,fixtures={}){
  const elements=new Map(),head=new Node('head'),body=new Node('body'),bottom=new Node('div'),
  bar=new Node('header'),formHint=new Node('p'),noteLine=new Node('p');
  let creations=0,timerId=0;
  for(const id of ['about-dialog','journal','status','wanted-view','about-counts','search',
  'about-community','editor','map-frame','wiki-field','wiki','name','category','note'])elements.set(id,
  Object.assign(new Node('div'),{
    dataset:{},value:''
  }));
  {
    const form=new Node('form');
    form.append(elements.get('name'));
    for(const id of ['suggest-on-save','suggest-check'])elements.set(id,Object.assign(new Node(id==='suggest-check'?
    'input':'div'),{
      dataset:{},checked:false
    }));
    const credit=Object.assign(new Node('input'),{
      checked:false
    }),row=new Node('label');
    row.append(credit);
    elements.set('suggest-credit',credit);
  }
  elements.get('category').options=['Personal','Vendor','Quest','Mob camp','Named mob','Class trainer'].map(value=>
  ({
    value
  }));
  elements.get('editor').querySelector=()=>formHint;
  const panelButton=new Node('button','Search menu');
  bar.append(panelButton);
  elements.set('toggle-panel',panelButton);
  const timers=new Map(),listeners=new Map(),saved=new Map(),calls=[],counts=[],statuses=[],
  remotePrivate=[],remote=fixtures.notes||[{
    id:'personal-remote',name:'Remote',category:'Personal',note:'',x:40,y:50
  },{
    id:'personal-local',name:'Older remote',category:'Personal',note:'',x:1,y:2
  }
  ];
  elements.get('map-frame').getBoundingClientRect=()=>({
    left:10,top:80,right:610,bottom:580,width:600,height:500
  });
  const user=session?.user,suggestions=[],layers=[],banned=[];
  let authHandler,failNotes=false,failSuggestions=false,recordInserts=false,missingVersion=
  false,suggestionFault=null;
  function result(table,request){
    calls.push({
      table,...request
    });
    if(table==='admins')return {
      data:user?.admin?{
        user_id:user.id
      }
      :null
    };
    if(table==='user_notes'){
      const rows=(request.filters.map||request.payload?.map||'').endsWith('#private')?remotePrivate:remote;
      if(request.op==='select')return {
        data:{
          notes:structuredClone(rows)
        }
      };
      if(failNotes)return {
        error:Error('offline')
      };
      rows.splice(0,rows.length,...request.payload.notes);
      return {
        data:null
      };
    }
    if(table==='banned'){
      if(request.op==='insert'){
        banned.push(request.payload);
        return {
          data:null
        };
      }
      if(request.op==='delete'){
        banned.splice(banned.findIndex(r=>r.user_id===request.filters.user_id),1);
        return {
          data:null
        };
      }
      return {
        data:banned.map(r=>({
          ...r,banned_at:new Date().toISOString()
        }))
      };
    }
    if(table==='suggestions'&&request.op==='update'&&request.filters.user_id&&request.filters.id===undefined){
      for(const row of suggestions)if(row.user_id===request.filters.user_id&&
        row.status===request.filters.status)Object.assign(row,
      request.payload);
      return {
        data:null
      };
    }
    if(table==='suggestions'){
      const fault=suggestionFault?.(request,suggestions);
      if(fault)return fault;
      if(missingVersion&&request.since?.key==='updated_at')return {
        error:{
          message:'column suggestions.updated_at does not exist'
        }
      };
      if(failSuggestions)return {
        error:Error('offline')
      };
      if(request.op==='insert'){
        const id=1000+calls.length;
        if(recordInserts)suggestions.push({
          ...structuredClone(request.payload),id,status:'pending',reviewed_at:null,updated_at:'sent-v1',
          created_at:new Date().toISOString()
        });
        return {
          data:request.columns==='*'?structuredClone(suggestions.find(r=>r.id===id)):{
            id
          }
        };
      }
      if(request.op==='update'){
        const row=suggestions.find(r=>r.id===request.filters.id);
        if(row){
          if(request.filters.user_id&&request.filters.user_id!==row.user_id||request.filters.status&&
          request.filters.status!==row.status)return {
            data:[]
          };
          if(Object.hasOwn(request.filters,'reviewed_at')&&request.filters.reviewed_at!==row.reviewed_at&&
          !(request.filters.reviewed_at===null&&!row.reviewed_at)||request.filters.updated_at&&
          request.filters.updated_at!==row.updated_at)return {
            data:[]
          };
          Object.assign(row,request.payload);
          if(row.updated_at)row.updated_at=new Date(1800000000000+calls.length).toISOString();
          return {
            data:[structuredClone(row)]
          };
        }
        return {
          data:[{
            id:request.filters.id
          }
          ]
        };
      }
      if(request.op==='delete'&&request.filters.id!==undefined){
        const i=suggestions.findIndex(r=>r.id===request.filters.id);
        if(i<0)return {
          data:[]
        };
        const row=suggestions[i];
        if(Object.entries(request.filters).some(([k,v])=>k!=='id'&&(k==='reviewed_at'&&v===null?
        !!row[k]:row[k]!==v)))return {
          data:[]
        };
        suggestions.splice(i,1);
        return {
          data:[{
            id:request.filters.id
          }
          ]
        };
      }
      if(request.op==='select'&&request.filters.id!==undefined)return {
        data:suggestions.find(r=>r.id===request.filters.id)||null
      };
      return {
        data:request.op==='select'?suggestions.filter(r=>(!request.filters.status||r.status===request.filters.status)&&
        (!request.filters.kind||r.kind===request.filters.kind)&&
        (!request.in||request.in.values.includes(r[request.in.key]))&&
        (!request.filters.user_id||r.user_id===request.filters.user_id)&&(!request.filters.map||
        r.map===request.filters.map)&&
        (!request.since||String(r[request.since.key]||'')>=request.since.value)).slice(request.range?.[0]||
        0,(request.range?.[1]??999999)+1):[]
      };
    }
  }
  const client={
    rpc:async(name)=>{
      calls.push({
        rpc:name
      });
      return {
        error:null
      };
    },from(table){
      const request={
        op:'select',filters:{}
      },query={
        select(columns,options){
          request.columns=columns;
          request.selectOptions=options;
          return query;
        },is(k,v){
          request.filters[k]=v;
          return query;
        },eq(k,v){
          request.filters[k]=v;
          return query;
        },in(k,v){
          request.in={
            key:k,values:v
          };
          return query;
        },gte(k,v){
          request.since={
            key:k,value:v
          };
          return query;
        },order(k,options){
          (request.order??=[]).push({
            key:k,...options
          });
          return query;
        },range(a,b){
          request.range=[a,b];
          return query;
        },limit(){
          return query;
        },maybeSingle(){
          return query;
        },single(){
          return query;
        },upsert(payload){
          request.op='upsert';
          request.payload=payload;
          return query;
        },insert(payload){
          request.op='insert';
          request.payload=payload;
          return query;
        },update(payload){
          request.op='update';
          request.payload=payload;
          return query;
        },delete(){
          request.op='delete';
          return query;
        },then(done,reject){
          return Promise.resolve(result(table,request)).then(done,reject);
        }
      };
      return query;
    },auth:{
      onAuthStateChange(fn){
        authHandler=fn;
      },getSession:async()=>({
        data:{
          session
        }
      }),signInWithOAuth:async options=>{
        calls.push({
          oauth:options
        });
        return {};
      },signOut:async options=>{
        calls.push({
          signOut:options
        });
        authHandler('SIGNED_OUT',null);
        return {};
      }
    }
  };
  const descendants=node=>[node,...node.children.flatMap(descendants)];
  const documentEvents=new Map();
  body.append(elements.get('journal'));
  const document={
    head,body,hidden:false,createElement(tag){
      creations++;
      const n=new Node(tag);
      n.dataset={};
      return n;
    },getElementById(id){
      return elements.get(id)||[...descendants(body),...descendants(bar),
        ...descendants(elements.get('map-frame'))].find(n=>
      n.id===id)||null;
    },querySelector(selector){
      return selector==='.journal-bottom'?bottom:selector==='.journal-bottom .backup'?{
        previousElementSibling:noteLine
      }
      :[...descendants(body),...descendants(bar)].find(n=>n.matches(selector))||null;
    },addEventListener(k,fn){
      (documentEvents.get(k)||documentEvents.set(k,[]).get(k)).push(fn);
    },removeEventListener(k,fn){
      documentEvents.set(k,(documentEvents.get(k)||[]).filter(f=>f!==fn));
    }
  };
  const store=new Map(),wikiRequests=[],context={
    document,URL,Date,Map,Set,JSON,console,AbortController,Event:class{
      constructor(type){
        this.type=type;
      }
    },fetch:async(url,options)=>{
      wikiRequests.push({
        url,options
      });
      return {
        ok:true,status:200,json:async()=>({
          results:[{
            id:'npc-banker',type:'npc',name:'Banker',zone:'Night Harbor',
            url:'https://monstersandmemories.wiki/npcs/banker'
          },{
            id:'bank-note',type:'item',name:'Bank note',zone:'Night Harbor',
            url:'https://monstersandmemories.wiki/items/bank-note'
          }
          ]
        })
      };
    },enabled:new Set(),showPins:true,mobileLayout:{
      matches:false
    },embedded:false,localStorage:{
      getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>
      store.delete(k)
    },atlasConfig:{
      supabaseUrl:'',supabaseKey:'',goatcounter:'',...settings
    },location:{
      hostname,href:'https://atlas.example/?map=test-map#private'
    },config:{
      id:'test-map',tileRevision:'v1',title:'Test map',width:200,height:200,minZoom:0,levelId:'lower',
      levels:[{
        id:'lower'
      },{
        id:'upper'
      }
      ]
    },map:{},loading:false,loadSerial:1,alignmentMode:false,pins:new Map(),originals:[{
      id:'published',name:'Bank',category:'Bank',note:'',x:12,y:22,level:'lower'
    }
    ],personal:fixtures.personal||[{
      id:'personal-local',name:'Local wins',category:'Personal',note:'private note',x:10,y:20
    }
    ],labelData:{
      labels:[]
    },publishedPositions:new Map([['published',[10,20]]]),publishedLabelPositions:new Map(),
    text:(...args)=>new Node(...args),button:(label,action,cls,icon)=>{
      const b=new Node('button',label,cls);
      b.type='button';
      b.onclick=action;
      b.dataset={
        icon
      };
      return b;
    },externalLink:(label,href,cls)=>Object.assign(new Node('a',label,cls),{
      href,target:'_blank',rel:'noopener'
    }),
    fillSelect(select,items){
      for(const item of items){
        if(Array.isArray(item)){
          select.append(Object.assign(new Node('option',item[0]),{
            value:item[1]
          }));
          continue;
        }
        const set=new Node('optgroup');
        set.label=item.label;
        context.fillSelect(set,item.options);
        select.append(set);
      }
      return select;
    },
    vendorKindItems:()=>[{
      label:'Food and drink',options:[['Cook','Cook']]
    }
    ],categoryChoices:()=>['Personal','Tradeskill','Vendor'],privateOnlyCategories:new Set(['Herbs',
    'Wood','Ore']),privateOnly:m=>!!m&&!m.noteType&&['Herbs','Wood','Ore'].includes(m.category),
    tradePaths:{
      Cooking:''
    },actionIcon(){},guessVendor(){},
    pickClasses(list){
      const wiki=context.$("wiki");
      wiki.dataset.wikiClasses=JSON.stringify(list||[]);
    },markerTitle:m=>m.name,pickedClasses(){
      try{
        return JSON.parse(context.$("wiki").dataset.wikiClasses||'[]');
      }
      catch{
        return [];
      }
    },status:message=>statuses.push(message),compact:()=>false,
    setPanel(){},choose(){},setupCategoryControls(){},buildPlaceIndex(){},
    valid:m=>!!m.id&&Number.isFinite(m.x)&&Number.isFinite(m.y),localStorage:{
      getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)
    },setTimeout(fn,ms){
      const id=++timerId;
      timers.set(id,{
        fn,ms
      });
      return id;
    },clearTimeout:id=>timers.delete(id)
  };
  context.$=id=>document.getElementById(id);
  context.window={
    supabase:{
      createClient(...args){
        calls.push({
          createClient:args
        });
        return client;
      }
    },addEventListener(k,fn){
      if(!listeners.has(k))listeners.set(k,[]);
      listeners.get(k).push(fn);
    },dispatchEvent(event){
      for(const fn of listeners.get(event.type)||[])fn(event);
    }
  };
  context.registry={
    maps:[{
      id:'test-map',title:'Test map',levels:context.config.levels
    }
    ]
  };
  context.labelPins=new Map();
  context.exitArrows=fieldChoices.exitArrows;
  context.tradePaths=fieldChoices.tradePaths;
  context.travelKind=()=>'';
  context.travelSvg=()=>new Node('svg');
  context.fetchData=async()=>[];
  context.window.confirm=()=>true;
  context.L=undefined;
  context.config.defaultView={
    placeZoom:3
  };
  context.map.closePopup=()=>{};
  context.map.on=()=>{};
  context.map.off=()=>{};
  context.map.fitBounds=()=>{};
  context.map.setView=()=>{};
  context.bounded=(x,y)=>Number.isFinite(x)&&Number.isFinite(y);
  context.locationOf=m=>[m.x,m.y];
  context.L={
    divIcon:options=>options,layerGroup(){
      const layer={
        items:[],addTo(){
          layers.push(layer);
          return layer;
        },addLayer(item){
          layer.items.push(item);
        },remove(){
          layer.removed=true;
        }
      };
      return layer;
    },circleMarker(where,options){
      return {
        where,options,bindTooltip(){
          return this;
        }
      };
    },polyline(where,options){
      return {
        where,options,getLatLngs(){
          return where;
        },setLatLngs(w){
          where=w;
        }
      };
    },marker(where,options){
      return {
        where,options,off(){
          return this;
        },bindTooltip(content,options){
          this.tooltip=content;
          this.tooltipOptions=options;
          return this;
        },bindPopup(content){
          this.popup=content;
          return this;
        },events:{},on(name,fn){
          (this.events[name]??=[]).push(fn);
          return this;
        },fire(name){
          for(const fn of this.events[name]||[])fn();
        },setIcon(icon){
          this.options.icon=icon;
        },addTo(layer){
          layer.addLayer(this);
          return this;
        },setLatLng(point){
          where=point;
          return this;
        },openPopup(){
          this.opened=true;
        },getLatLng(){
          return where;
        }
      };
    },latLngBounds:locations=>locations
  };
  context.structuredClone=structuredClone;
  context.categories={
    Personal:['P','#a04438'],Tradeskill:['T','#385f60'],Vendor:['V','#876036'],Bank:['B','#4d5560']
  };
  context.markerSymbol=()=>document.createElement('b');
  context.pinIcon=m=>({
    look:m
  });
  context.pixelsOf=where=>where;
  context.allMarkers=()=>[...context.originals,...context.personal];
  context.visibleMarkers=()=>context.allMarkers();
  context.popup=m=>{
    const n=new Node('div');
    context.window.atlasCommunity?.popup(m,n);
    return n;
  };
  context.drawMarkers=()=>{
    for(const m of context.allMarkers())context.pins.set(m.id,{
      setPopupContent(){}
    });
  };
  context.persist=next=>{
    saved.set('notes',JSON.stringify(next));
    context.personal=next;
    context.window.dispatchEvent({
      type:'atlas:notes'
    });
    return true;
  };
  context.storageKey=k=>'mnmaps-test-map-'+k+'-v1';
  context.CustomEvent=class{
    constructor(type,options){
      this.type=type;
      this.detail=options?.detail;
    }
  };
  context.notesReadable=true;
  context.singleMap=false;
  context.alignmentPositions={};
  context.alignmentLabelPositions={};
  context.editSnapshot=null;
  context.updateAlignmentStatus=()=>{};
  context.matchMedia=()=>({
    matches:true
  });
  context.markerSubtitle=()=>'';
  context.noteKind=m=>m.category;
  context.noteFields={
    root:new Node('div'),attachFinder(make,picked){
      context.testWikiFinder=make;
      const f=make(context.$('wiki'),picked,context.$('name'),{
        enabled:()=>context.$('category').value!=='Mob camp'
      });
      context.$('name').after(f);
    }
  };
  context.campCard=()=>new Node('div');
  vm.createContext(context);
  vm.runInContext(app.slice(app.indexOf('function shapeShown('),app.indexOf('function drawMarkers(')),
  context);
  vm.runInContext(app.slice(app.indexOf('// Private annotations'),app.indexOf('function migratePreviousStorage(')),
  context);
  vm.runInContext(awaitSchema,context,{filename:'marker-schema.js'});
  vm.runInContext(wikiLinks,context,{
    filename:'wiki-links.js'
  });
  vm.runInContext(app.slice(app.indexOf('const az='),app.indexOf('const baseCategories=')),
  context);
  vm.runInContext(app.slice(app.indexOf('const markerHover='),app.indexOf('// NPC wiki cards')),
  context);
  vm.runInContext(changes,context,{
    filename:'changes.js'
  });
  vm.runInContext(fields,context,{
    filename:'marker-fields.js'
  });
  vm.runInContext(reviewModel,context,{
    filename:'review-model.js'
  });
  vm.runInContext(reviewDesk,context,{
    filename:'review-desk.js'
  });
  const makeDesk=context.window.createReviewDesk;
  context.window.createReviewDesk=hooks=>context.window.testReviewDesk=makeDesk(hooks);
  vm.runInContext(notices,context);
  // Expose closures for observation without replacing any production function.
  const observed=fixtures.expose?source.replace(/\}\)\(\);\s*$/, `
 window.testCommunity={notePayload,followNote,retirePublishedNotes,followId,
 readFollowed,writeFollowed,editDialog,setBountyForm,claimBounty,
 sync:()=>syncNotes(mapSerial),retire:()=>retirePublishedNotes(mapSerial),
 attachNoteFinder:()=>{noteFinderReady=false;attachNoteFinder();}};
})();`):source;
  vm.runInContext(observed,context,{
    filename:'community.js'
  });
  return {
    key(key,target=context.$('review-desk')||new Node('div'),extra={}){
      const ev={
        key,target,preventDefault(){
          this.prevented=true;
        },stopPropagation(){},stopImmediatePropagation(){
          this.stopped=true;
        },...extra
      };
      for(const fn of documentEvents.get('keydown')||[]){
        fn(ev);
        if(ev.stopped)break;
      }
      return ev;
    },authenticate:session=>authHandler('SIGNED_IN',session),context,wikiRequests,elements,head,
    body,bottom,bar,calls,counts,statuses,remote,remotePrivate,saved,suggestions,layers,banned,
    get creations(){
      return creations;
    },set failNotes(v){
      failNotes=v;
    },set failSuggestions(v){
      failSuggestions=v;
    },set recordInserts(v){
      recordInserts=v;
    },set missingVersion(v){
      missingVersion=v;
    },set suggestionFault(v){
      suggestionFault=v;
    },emit:type=>context.window.dispatchEvent({
      type
    }),async tick(ms){
      const jobs=[...timers].filter(([,t])=>t.ms===ms);
      for(const [id,t] of jobs){
        timers.delete(id);
        t.fn();
      }
      await settle();
    }
  };
}
export {
  Node, settle, environment
};
