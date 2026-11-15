/* Local geographic view. Coordinates are city or region centres; each family event keeps its citations. */
window.FamilyMap = (() => {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const kindName = {
    birth:'Народження', residence:'Проживання', study:'Навчання', work:'Робота',
    service:'Служба', visit:'Перебування', death:'Смерть', burial:'Поховання',
    marriage:'Шлюб', baptism:'Хрещення'
  };
  const certaintyName = {documented:'За документом',reported:'Зі спогадів',possible:'Імовірно'};
  const durationName = {short:'Нетривало',long:'Тривало',unknown:'Тривалість невідома'};
  const precisionName = {locality:'',region:'Орієнтир у межах регіону',country:'Орієнтир у межах країни'};
  const degrees = 180/Math.PI;
  const clamp = (n,lo,hi) => Math.max(lo,Math.min(hi,n));
  const project = (lon,lat) => [Number(lon),-degrees*Math.asinh(Math.tan(clamp(Number(lat),-84,84)/degrees))];
  const yearOf = row => row.year === null || row.year === undefined || row.year === '' ? null : Number(row.year);
  const compareNames = (a,b) => a.localeCompare(b,'uk');
  const plural = new Intl.PluralRules('uk');
  function countLabel(n, one, few, many) {
    return n+' '+({one,few,many}[plural.select(n)] || many);
  }
  function html(tag,cls,text) {
    const node=document.createElement(tag);
    if(cls)node.className=cls;
    if(text!==undefined)node.textContent=text;
    return node;
  }
  function svg(tag,attrs,text) {
    const node=document.createElementNS(NS,tag);
    for(const [name,value] of Object.entries(attrs || {}))node.setAttribute(name,value);
    if(text!==undefined)node.textContent=text;
    return node;
  }
  function button(text,fn,cls) {
    const node=html('button',cls,text);node.type='button';node.addEventListener('click',fn);return node;
  }
  function create(container, options) {
    const {places,people,events,colors,sourceTitles={},openPerson,openSource,onSummary}=options;
    const geography=window.FamilyMapLand;
    const countryLabels=[...geography.land].sort((a,b)=>(b[0]==='UKR')-(a[0]==='UKR')||a[4]-b[4]);
    const names=new Map(people.map(person=>[person.id,person.name]));
    const palettes=new Map(colors.map(row=>[row.id,row.color]));
    const palette=id=>palettes.get(id)||'#55745e';
    const branchNames=new Map(colors.map(row=>[row.id,row.label]));
    function swatch(id){const icon=svg('svg',{class:'geo-swatch',viewBox:'0 0 12 12','aria-hidden':'true'});icon.append(svg('circle',{cx:6,cy:6,r:4.7,fill:palette(id),stroke:'#385242','stroke-width':.6}));return icon;}
    const placeIndex=new Map(places.map(place=>[place.id,{...place,point:project(place.lon,place.lat)}]));
    const all=events.filter(row=>placeIndex.has(row.placeId)&&names.has(row.personId));
    const family=html('section','family-geo');
    container.replaceChildren(family);
    const frame=html('div','geo-frame'), footer=html('div','geo-footer');
    family.append(frame,footer);
    const stage=html('div','geo-stage');stage.tabIndex=0;stage.setAttribute('role','region');
    stage.setAttribute('aria-label','Географічна мапа. Стрілки переміщують мапу, плюс і мінус змінюють масштаб.');
    const atlas=svg('svg',{class:'geo-atlas','aria-hidden':'true'});
    const overlays=svg('svg',{class:'geo-overlay',role:'group','aria-label':'Місця в родинному дереві'});
    const land=svg('g'),countries=svg('g'),rivers=svg('g'),districts=svg('g');
    const details=svg('g',{'aria-hidden':'true'}),route=svg('g',{'aria-hidden':'true'}), markers=svg('g');
    land.append(countries,rivers,districts);atlas.append(land);overlays.append(details,route,markers);stage.append(atlas,overlays);
    for(const [iso,,,,,d] of geography.land)countries.append(svg('path',{class:'geo-land'+(iso==='UKR'?' home':''),d}));
    for(const d of geography.rivers)rivers.append(svg('path',{class:'geo-rivers',d}));
    for(const d of geography.districts)districts.append(svg('path',{class:'geo-districts',d}));
    const tip=html('div','geo-tip');tip.hidden=true;
    const empty=html('p','geo-empty','Для цього вибору місць ще немає.');empty.hidden=true;
    const panel=html('aside','geo-panel');panel.hidden=true;
    const nav=html('div','geo-nav');nav.setAttribute('role','group');nav.setAttribute('aria-label','Масштаб мапи');
    const zoomOut=button('−',()=>zoom(1/1.4,width/2,height/2));
    const zoomIn=button('+',()=>zoom(1.4,width/2,height/2));
    const fitButton=button('',()=>{fit();schedule()});
    const fitIcon=svg('svg',{viewBox:'0 0 24 24','aria-hidden':'true'});
    fitIcon.append(svg('path',{d:'M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4'}));fitButton.append(fitIcon);
    for(const [b,t] of [[zoomOut,'Зменшити масштаб'],[zoomIn,'Збільшити масштаб'],[fitButton,'Умістити всі вибрані місця']]){b.title=t;b.setAttribute('aria-label',t);}
    nav.append(zoomOut,zoomIn,fitButton);
    const scaleBar=html('div','geo-scale'),scaleText=html('span'),scaleLine=html('i');
    scaleBar.setAttribute('aria-hidden','true');scaleBar.append(scaleText,scaleLine);
    frame.append(stage,tip,empty,panel,nav,scaleBar);
    const key=html('div','geo-key');
    key.append(html('strong',null,'Проживання'));
    for(const state of ['long','short','unknown']){const k=html('span');k.append(html('i',state),document.createTextNode(durationName[state]));key.append(k);}
    const footerRight=html('div','geo-detail-footer'),routeKey=html('span');
    routeKey.append(html('i','geo-route-key'),document.createTextNode(' Послідовність датованих місць'));
    routeKey.hidden=true;
    const attribution=html('a',null,'Natural Earth');attribution.href='https://www.naturalearthdata.com/';attribution.target='_blank';attribution.rel='noreferrer';
    const geonames=html('a',null,'GeoNames');geonames.href='https://www.geonames.org/about.html';geonames.target='_blank';geonames.rel='noreferrer';
    const license=html('a',null,'CC BY 4.0');license.href='https://creativecommons.org/licenses/by/4.0/';license.target='_blank';license.rel='noreferrer';
    const coordinateCredit=html('span');coordinateCredit.append(geonames,document.createTextNode(' · '),license);
    footerRight.append(routeKey,attribution,coordinateCredit);footer.append(key,footerRight);

    let width=0,height=0,cx=29,cy=project(29,49)[1],scale=20,didFit=false,queued=0;
    let sourceMode='all',personId='',rows=[],sites=[],selection=null,lastFocus=null;
    let matching=[],matchingPeople=new Set(),summary='';
    let personIds=null,lineage=null;
    let suppressClickUntil=0;
    const pointers=new Map();
    function screen([x,y]) {return [width/2+(x-cx)*scale,height/2+(y-cy)*scale];}
    function mapPoint(x,y) {return [cx+(x-width/2)/scale,cy+(y-height/2)/scale];}
    function hideTip(){tip.hidden=true}
    function schedule(){if(!queued)queued=requestAnimationFrame(()=>{queued=0;draw()});}
    function measure(){
      const w=stage.clientWidth,h=stage.clientHeight;
      if(!w||!h)return;
      if(w!==width||h!==height){width=w;height=h;atlas.setAttribute('viewBox',`0 0 ${w} ${h}`);overlays.setAttribute('viewBox',`0 0 ${w} ${h}`);}
      if(!didFit)fit();schedule();
    }
    function fit(points=sites.map(s=>s.place.point)){
      if(!width||!height)return;
      if(!points.length)points=[project(22,46),project(40,52.8)];
      const xx=points.map(p=>p[0]),yy=points.map(p=>p[1]);
      const minX=Math.min(...xx),maxX=Math.max(...xx),minY=Math.min(...yy),maxY=Math.max(...yy);
      // Keep the selected person's route clear of the desktop detail panel.
      const reserve=!panel.hidden&&width>=850?Math.min(348,width*.35):0;
      const mx=Math.min(78,width*.14),my=Math.min(66,height*.16);
      scale=clamp(Math.min((width-reserve-mx*2)/Math.max(maxX-minX,2.5),(height-my*2)/Math.max(maxY-minY,1.6)),1.3,4400);
      cx=(minX+maxX)/2+reserve/(2*scale);cy=(minY+maxY)/2;didFit=true;
    }
    function containCentre(){cx=clamp(cx,-179,179);cy=clamp(cy,-168,168);}
    function zoom(factor,x,y) {
      const before=mapPoint(x,y);scale=clamp(scale*factor,1.3,4400);
      cx=before[0]-(x-width/2)/scale;cy=before[1]-(y-height/2)/scale;containCentre();hideTip();schedule();
    }
    function focusPlace(id){
      const place=placeIndex.get(id);if(!place)return;
      cx=place.point[0]+(!panel.hidden&&width>=850?160:0)/Math.max(scale,70);
      cy=place.point[1];scale=Math.max(scale,70);schedule();
    }
    function updateSites(keepPlace){
      rows=personId ? matching.filter(event=>event.personId===personId) : matching;
      const byPlace=new Map();
      for(const e of rows){
        if(!byPlace.has(e.placeId))byPlace.set(e.placeId,{place:placeIndex.get(e.placeId),events:[]});
        byPlace.get(e.placeId).events.push(e);
      }
      sites=[...byPlace.values()].sort((a,b)=>b.events.length-a.events.length||compareNames(a.place.name,b.place.name));
      const total=new Set(rows.map(e=>e.personId)).size;
      summary='На мапі '+countLabel(sites.length,'місце','місця','місць')+' · '+countLabel(total,'людина','людини','людей');
      onSummary(summary);
      empty.hidden=!!sites.length;
      if(keepPlace && byPlace.has(keepPlace))showPlacePanel(keepPlace);
      else if(personId)showPersonPanel();
      else closePanel(false);
      didFit=false;measure();
    }
    function choosePerson(id){
      personId=matchingPeople.has(id) ? id : '';
      updateSites();
    }
    function show(state={}){
      // These IDs come from the tree's active scope, relationship group and generation depth.
      if(Object.hasOwn(state,'personIds'))personIds=state.personIds;
      if(Object.hasOwn(state,'lineage'))lineage=state.lineage;
      const nextMode=state.sourceMode ?? sourceMode;
      const nextMatching=all.filter(event=>
        (!personIds || personIds.has(event.personId)) &&
        (!lineage || event.branch===lineage || event.branches?.includes(lineage)) &&
        (nextMode==='all' || event.sourceIdsByMode[nextMode]?.length)
      );
      const changed=sourceMode!==nextMode || matching.length!==nextMatching.length ||
        nextMatching.some((event,index)=>event!==matching[index]);
      if(changed){
        sourceMode=nextMode;
        matching=nextMatching;
        matchingPeople=new Set(matching.map(event=>event.personId));
      }
      const requested=Object.hasOwn(state,'personId') ? state.personId : personId;
      const nextPerson=matchingPeople.has(requested) ? requested : '';
      if(nextPerson!==personId)choosePerson(nextPerson);
      else if(changed || !summary)updateSites(selection?.place);
      // Returning from the tree restores the map count without moving the map.
      else onSummary(summary);
    }
    function closePanel(restore){
      selection=null;panel.hidden=true;hideTip();schedule();
      if(restore)(lastFocus?.isConnected?lastFocus:stage).focus({preventScroll:true});
    }
    function dismissPanel(){
      if(personId && selection?.person){
        choosePerson('');
        stage.focus({preventScroll:true});
      }else if(personId){
        showPersonPanel();
        panel.querySelector('button')?.focus({preventScroll:true});
      }else closePanel(true);
    }
    function panelHead(title,meta){
      hideTip();panel.hidden=false;panel.setAttribute('aria-label',title);
      const header=html('header','geo-panel-head'),text=html('div'),h=html('h3',null,title);
      text.append(h);if(meta)text.append(html('p',null,meta));
      const close=button('×',dismissPanel,'geo-panel-close');
      close.setAttribute('aria-label','Закрити відомості на мапі');header.append(text,close);
      const body=html('div','geo-panel-body');panel.replaceChildren(header,body);panel.scrollTop=0;
      return body;
    }
    function addEvent(body,e,timeline) {
      const item=html('article','geo-entry'), title=html('h4');
      if(timeline){
        const loc=placeIndex.get(e.placeId);title.append(button(loc.name,()=>{focusPlace(loc.id);showPlacePanel(loc.id);},'geo-link'));
      }else title.append(button(names.get(e.personId),()=>openPerson(e.personId),'geo-link'));
      const meta=html('div','geo-entry-meta');
      meta.append(html('span',null,kindName[e.kind]||e.kind),html('span',null,e.period||'Дата невідома'));
      const ids=[...new Set([e.branch,...(e.branches||[])])];
      for(const id of ids){if(!branchNames.has(id))continue;const tag=html('span','geo-event-branch');tag.append(swatch(id),document.createTextNode(branchNames.get(id)));meta.append(tag);}
      item.append(title,meta);
      const citations=sourceMode==='all' ? e.sourceIds : e.sourceIdsByMode[sourceMode];
      // Mixed notes describe their citations jointly. Only show their wording with all supporting material.
      if(e.note && citations.length===e.sourceIds.length)item.append(html('p',null,e.note));
      const proof=html('div','geo-entry-meta');
      proof.append(html('span',null,certaintyName[e.certainty]||e.certainty));
      if(e.duration!=='unknown'&&durationName[e.duration])proof.append(html('span',null,durationName[e.duration]));
      item.append(proof);
      if(citations.length){
        const links=html('div','geo-entry-sources');links.append(html('span',null,'Джерела'));
        for(const id of citations){const ref=button(id,()=>openSource(id),'geo-link');const title=sourceTitles[id]||id;ref.title=title;ref.setAttribute('aria-label','Джерело '+id+' · '+title);links.append(ref);}
        item.append(links);
      }
      body.append(item);
    }
    function dateSort(a,b){return (yearOf(a)??Infinity)-(yearOf(b)??Infinity)||compareNames(names.get(a.personId),names.get(b.personId));}
    function showPersonPanel(){
      if(!personId)return;selection={person:personId};
      const body=panelHead(names.get(personId),countLabel(sites.length,'місце','місця','місць')+' · '+countLabel(rows.length,'подія','події','подій'));
      const actions=html('div','geo-panel-actions');actions.append(button('Картка людини',()=>openPerson(personId)),button('Усі люди',()=>choosePerson('')));body.append(actions);
      for(const e of [...rows].sort(dateSort))addEvent(body,e,true);
    }
    function showPlacePanel(id) {
      const site=sites.find(s=>s.place.id===id);if(!site)return;selection={place:id};
      const namesHere=new Set(site.events.map(e=>e.personId));
      const prec=precisionName[site.place.precision]||'';
      const subtitle=[countLabel(namesHere.size,'людина','людини','людей'),countLabel(site.events.length,'подія','події','подій'),prec].filter(Boolean).join(' · ');
      const body=panelHead(site.place.name,subtitle);
      if(typeof site.place.reference==='string'&&/^https:\/\/[^\s]+$/.test(site.place.reference)){
        const credit=html('a',null,'Координати місця');
        credit.href=site.place.reference;credit.target='_blank';credit.rel='noreferrer';credit.className='geo-place-reference';body.append(credit);
      }
      if(personId){const actions=html('div','geo-panel-actions');actions.append(button('Усі місця людини',()=>{showPersonPanel();fit();schedule()}));body.append(actions);}
      const peopleHere=[...namesHere].sort((a,b)=>compareNames(names.get(a),names.get(b)));
      for(const id of peopleHere){
        const personEvents=site.events.filter(e=>e.personId===id).sort(dateSort);
        for(const e of personEvents)addEvent(body,e,false);
        if(!personId){const actions=html('div','geo-panel-actions');const show=button('Місця цієї людини',()=>choosePerson(id));show.setAttribute('aria-label','Місця на мапі · '+names.get(id));actions.append(show);body.append(actions);}
      }
      schedule();
    }
    function groupPanel(group){
      lastFocus=document.activeElement;hideTip();
      if(group.sites.length===1){showPlacePanel(group.sites[0].place.id);return;}
      selection={cluster:group.sites.map(s=>s.place.id)};
      const body=panelHead(countLabel(group.sites.length,'місце','місця','місць'),'Місця поруч');
      const actions=html('div','geo-panel-actions');
      actions.append(button('Наблизити ці місця',()=>{
        const points=group.sites.map(s=>s.place.point);
        if(personId)showPersonPanel();else closePanel(false);
        const x=points.map(v=>v[0]),y=points.map(v=>v[1]);
        cx=(Math.min(...x)+Math.max(...x))/2;cy=(Math.min(...y)+Math.max(...y))/2;
        scale=clamp(Math.max(scale*2,Math.min(width*.58/Math.max(.01,Math.max(...x)-Math.min(...x)),height*.58/Math.max(.01,Math.max(...y)-Math.min(...y)))),1.3,4400);
        schedule();
      }));body.append(actions);
      for(const site of [...group.sites].sort((a,b)=>compareNames(a.place.name,b.place.name))){
        const b=button('',()=>showPlacePanel(site.place.id),'geo-place-choice');
        b.append(html('strong',null,site.place.name),html('small',null,countLabel(new Set(site.events.map(e=>e.personId)).size,'людина','людини','людей')));body.append(b);
      }
    }
    // An unknown year or two different places within one year cannot establish a travel order.
    function routeSegments(){
      if(!personId)return [];
      const dated=rows.filter(e=>Number.isFinite(yearOf(e))).sort(dateSort);
      let prior=null,start=0;const segments=[];
      for(let i=0;i<=dated.length;i++){
        if(i<dated.length&&i>start&&yearOf(dated[i])===yearOf(dated[start]))continue;
        if(i>start){
          const members=dated.slice(start,i);
          // A country and city can describe the same year's event at two scales.
          // Retain a uniquely supported locality; a year with only broad or competing places breaks the chain.
          const local=members.filter(e=>placeIndex.get(e.placeId).precision==='locality');
          const ids=new Set(local.map(e=>e.placeId));
          const current=ids.size===1&&local.every(e=>e.certainty!=='possible')
            ?local.reduce((best,e)=>Number(e.endYear||0)>Number(best.endYear||0)?e:best)
            :null;
          if(prior&&current&&prior.placeId!==current.placeId&&(!prior.endYear||Number(prior.endYear)<=yearOf(current)))segments.push([prior,current]);
          prior=current;start=i;
        }
      }
      return segments;
    }
    function clusters(){
      const groups=[];
      for(const site of sites){
        const [x,y]=screen(site.place.point);if(x< -20||y< -20||x>width+20||y>height+20)continue;
        const near=groups.find(g=>Math.hypot(g.x-x,g.y-y)<34);
        if(near){near.sites.push(site);continue;}
        groups.push({x,y,sites:[site]});
      }
      return groups;
    }
    function tracking(g){
      const list=g.sites.flatMap(s=>s.events);
      const branches=new Map();
      for(const e of list){
        if(!branches.has(e.branch))branches.set(e.branch,new Set());
        branches.get(e.branch).add(e.personId);
      }
      const residence=list.filter(e=>e.kind==='residence'||e.duration==='long'||e.duration==='short');
      const duration=residence.some(e=>e.duration==='long')?'long':residence.some(e=>e.duration==='short')?'short':'unknown';
      return {list,branches,duration};
    }
    function groupLabel(g){return g.sites.length>1?countLabel(g.sites.length,'місце','місця','місць'):g.sites[0].place.name;}
    function tooltip(g,info){
      if(pointers.size>0)return;
      tip.replaceChildren(html('strong',null,g.sites.length>1?g.sites.slice(0,3).map(s=>s.place.name).join(', '):g.sites[0].place.name));
      const ids=[...new Set(info.list.map(e=>e.personId))];
      const items=ids.slice(0,2).map(id=>names.get(id));if(ids.length>2)items.push('ще '+(ids.length-2));
      tip.append(html('span',null,items.join(' · ')));
      if(g.sites.length===1&&(precisionName[g.sites[0].place.precision]||info.duration!=='unknown'))tip.append(html('span',null,[precisionName[g.sites[0].place.precision],durationName[info.duration]].filter(Boolean).join(' · ')));
      tip.hidden=false;tip.style.left=clamp(g.x+14,5,width-tip.offsetWidth-5)+'px';tip.style.top=clamp(g.y-tip.offsetHeight-7,5,height-tip.offsetHeight-5)+'px';
    }
    function toSector(r,a,b){
      const pt=t=>[r*Math.cos(t),r*Math.sin(t)].map(v=>v.toFixed(2)).join(' ');
      return 'M0 0L'+pt(a)+'A'+r+' '+r+' 0 '+(b-a>Math.PI?1:0)+' 1 '+pt(b)+'Z';
    }
    function draw(){
      if(!width||!height)return;
      hideTip();land.setAttribute('transform',`translate(${width/2-cx*scale} ${height/2-cy*scale}) scale(${scale})`);
      rivers.style.display=scale<12?'none':'';districts.style.display=scale<15?'none':'';
      const groups=clusters(),collision=[];
      const occupied=(x1,y1,x2,y2)=>collision.some(r=>x1<r[2]&&x2>r[0]&&y1<r[3]&&y2>r[1]);
      groups.forEach(g=>collision.push([g.x-15,g.y-15,g.x+15,g.y+15]));
      const prevFocus=document.activeElement?.closest?.('.geo-location')?.dataset.key;
      const fragment=document.createDocumentFragment();let nextFocus=null;
      for(const g of groups){
        const {list,branches,duration}=tracking(g);
        const text=groupLabel(g),key=g.sites.map(s=>s.place.id).join('|');
        const count=new Set(list.map(e=>e.personId)).size;
        const marker=svg('g',{class:'geo-location',role:'button',tabindex:0,transform:`translate(${g.x} ${g.y})`,'aria-label':text+' · '+countLabel(count,'людина','людини','людей'),'data-key':key});
        const multi=g.sites.length>1||count>1;
        const r=multi?13:8,unknown=duration==='unknown';
        marker.append(svg('circle',{class:'geo-hit',r:r+5}));
        marker.append(svg('circle',{r:r+1,fill:'#fffdf3',stroke:'#fcfcf5','stroke-width':2}));
        // Areas show the branches present. Count people once per branch, across repeats.
        const total=[...branches.values()].reduce((sum,ids)=>sum+ids.size,0);
        let a=-Math.PI/2;const fillAlpha=duration==='long'?.94:duration==='short'?.41:.66;
        for(const [id,ids] of branches){
          const b=a+2*Math.PI*ids.size/total;
          const shape=branches.size===1?svg('circle',{r}):svg('path',{d:toSector(r,a,b)});
          shape.setAttribute('fill',palette(id));shape.setAttribute('fill-opacity',fillAlpha);marker.append(shape);a=b;
        }
        const selected=selection?.place&&g.sites.some(s=>s.place.id===selection.place);
        marker.append(svg('circle',{r:r+.8,fill:'none',stroke:branches.size===1?palette(branches.keys().next().value):'#435d50','stroke-width':1.5,'stroke-dasharray':unknown?'2.7 2.3':'none'}));
        if(selected)marker.append(svg('circle',{r:r+5,fill:'none',stroke:'#294e40','stroke-width':2}));
        if(multi)marker.append(svg('text',{class:'geo-marker-num','text-anchor':'middle',y:4},g.sites.length>1?g.sites.length:count));
        const compact=g.sites[0].place.name.split(/[,（(]/)[0].trim();
        const label=g.sites.length>1?compact+' +'+(g.sites.length-1):compact;
        const tw=label.length*7.6+5;
        for(const side of [1,-1]){
          const edge=g.x+side*Math.max(17,r+5),l=side===1?edge:edge-tw,rr=l+tw;
          if(l<3||rr>width-3||occupied(l,g.y-9,rr,g.y+8))continue;
          marker.append(svg('rect',{x:l-g.x,y:-10,width:tw,height:20,fill:'transparent'}));
          marker.append(svg('text',{class:'geo-marker-label',x:edge-g.x,y:4,'text-anchor':side===1?'start':'end'},label));
          collision.push([l,g.y-9,rr,g.y+8]);break;
        }
        marker.addEventListener('click',()=>{if(performance.now()<suppressClickUntil)return;groupPanel(g);});
        marker.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();groupPanel(g);panel.querySelector('button')?.focus();}});
        marker.addEventListener('pointerenter',e=>{if(e.pointerType!=='touch')tooltip(g,{list,duration});});marker.addEventListener('pointerleave',hideTip);
        marker.addEventListener('focus',()=>tooltip(g,{list,duration}));marker.addEventListener('blur',hideTip);
        if(key===prevFocus)nextFocus=marker;fragment.append(marker);
      }
      markers.replaceChildren(fragment);if(nextFocus)nextFocus.focus({preventScroll:true});
      const segs=routeSegments();routeKey.hidden=!segs.length;route.replaceChildren();
      for(const [a,b] of segs){
        const [x1,y1]=screen(placeIndex.get(a.placeId).point),[x2,y2]=screen(placeIndex.get(b.placeId).point);
        const color=palette(a.branch);
        route.append(svg('line',{x1,y1,x2,y2,stroke:'#fcfbef','stroke-width':4.5}),svg('line',{x1,y1,x2,y2,stroke:color,'stroke-width':2.1,'stroke-dasharray':'6 4'}));
      }
      const fragmentLabels=document.createDocumentFragment();
      for(const [iso,name,lon,merc,rank] of countryLabels){
        if(['ESB','WSB','CYN','KAS','DHE','ATC','KAB','SOL','USG','GIB','BRT','VGB','VAT','SMR','LIE','MCO','SJM'].includes(iso)&&scale<105)continue;
        const [cx,cy]=screen([lon,merc]);
        if(rank>(scale>35?7:scale>12?5:4))continue;
        const tw=name.length*7.5;
        const offsets=iso==='UKR'?[[0,0],[0,21],[0,-21],[0,42],[-34,-24],[34,24],[-45,41],[12,-45]]:[[0,0]];
        for(const [dx,dy] of offsets){
          const x=cx+dx,y=cy+dy;
          if(x-tw/2<3||x+tw/2>width-3||y<12||y>height-8||occupied(x-tw/2,y-10,x+tw/2,y+3))continue;
          fragmentLabels.append(svg('text',{x,y,class:'geo-country','text-anchor':'middle'},name.toLocaleUpperCase('uk')));
          collision.push([x-tw/2,y-11,x+tw/2,y+4]);break;
        }
      }
      if(scale>=11){
        for(const [name,lon,merc,pop,capital] of geography.cities){
          if(!capital&&scale<(pop>700000?17:pop>200000?30:52))continue;
          const [x,y]=screen([lon,merc]);const tw=name.length*6.6+8;
          if(x<4||x+tw>width||y<8||y>height-8||occupied(x-4,y-8,x+tw,y+8))continue;
          fragmentLabels.append(svg('circle',{cx:x,cy:y,r:capital?2.8:1.7,fill:'#859386'}),svg('text',{x:x+6,y:y+3,class:'geo-city'},name));
          collision.push([x-4,y-9,x+tw,y+9]);
        }
      }
      details.replaceChildren(fragmentLabels);
      const lat=Math.atan(Math.sinh(-cy/degrees)),kmPerPx=111.195*Math.cos(lat)/scale;
      const target=kmPerPx*70;
      const power=Math.pow(10,Math.floor(Math.log10(target)));
      const val=([5,2,1].find(n=>power*n<=target)||1)*power;
      scaleLine.style.width=(val/kmPerPx)+'px';
      scaleText.textContent=val>=1?val.toLocaleString('uk')+' км':Math.round(val*1000)+' м';
      zoomOut.disabled=scale<=1.3001;zoomIn.disabled=scale>=4399.9;
    }
    const localPoint=e=>{const r=stage.getBoundingClientRect();return [e.clientX-r.left,e.clientY-r.top];};
    const midpoint=(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2];
    let startPointer=null;
    stage.addEventListener('pointerdown',e=>{
      if(e.button!==0)return;hideTip();const p=localPoint(e);pointers.set(e.pointerId,p);
      if(pointers.size===1)startPointer=p;
      // Capture on the original target so a short tap still activates a marker.
      e.target.setPointerCapture?.(e.pointerId);
      if(pointers.size>1){suppressClickUntil=Infinity;stage.classList.add('dragging');}
    });
    stage.addEventListener('pointermove',e=>{
      const old=pointers.get(e.pointerId);if(!old)return;
      const next=localPoint(e);
      if(pointers.size===1){
        if(!stage.classList.contains('dragging')&&Math.hypot(next[0]-startPointer[0],next[1]-startPointer[1])<4)return;
        pointers.set(e.pointerId,next);cx-=(next[0]-old[0])/scale;cy-=(next[1]-old[1])/scale;
      }else{
        const other=[...pointers.entries()].find(([id])=>id!==e.pointerId)?.[1];if(!other)return;
        const mid=midpoint(old,other),nextMid=midpoint(next,other);
        const anchor=mapPoint(...mid);
        const ratio=Math.hypot(next[0]-other[0],next[1]-other[1])/Math.max(1,Math.hypot(old[0]-other[0],old[1]-other[1]));
        scale=clamp(scale*clamp(ratio,.65,1.5),1.3,4400);cx=anchor[0]-(nextMid[0]-width/2)/scale;cy=anchor[1]-(nextMid[1]-height/2)/scale;pointers.set(e.pointerId,next);
      }
      containCentre();suppressClickUntil=Infinity;stage.classList.add('dragging');
      // Capture on the persistent SVG parent once dragging starts; marker nodes are reprojected on each frame.
      if(stage.hasPointerCapture&&!stage.hasPointerCapture(e.pointerId))stage.setPointerCapture(e.pointerId);
      schedule();
    });
    function pointerUp(e){
      pointers.delete(e.pointerId);if(!pointers.size){stage.classList.remove('dragging');if(suppressClickUntil===Infinity)suppressClickUntil=performance.now()+320;}
      else {startPointer=[...pointers.values()][0];}
    }
    stage.addEventListener('pointerup',pointerUp);stage.addEventListener('pointercancel',pointerUp);
    stage.addEventListener('wheel',e=>{
      e.preventDefault();const units=e.deltaMode===1?16:e.deltaMode===2?height:1;
      zoom(Math.exp(-clamp(e.deltaY*units,-96,96)*(e.ctrlKey?.005:.0018)),...localPoint(e));
    },{passive:false});
    stage.addEventListener('keydown',e=>{
      if(e.target!==stage)return;
      const steps={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]};
      const d=steps[e.key];
      if(d){e.preventDefault();cx+=d[0]*60/scale;cy+=d[1]*60/scale;containCentre();schedule();}
      else if(['+','=','-','Home'].includes(e.key)){e.preventDefault();if(e.key==='Home'){fit();schedule();}else zoom(e.key==='-'?1/1.4:1.4,width/2,height/2);}
    });
    panel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();dismissPanel();}});
    new ResizeObserver(measure).observe(stage);
    return {resize:measure,show,searchableIds:()=>new Set(matchingPeople)};
  }
  return {create};
})();
