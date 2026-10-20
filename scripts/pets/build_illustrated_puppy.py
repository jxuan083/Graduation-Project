"""Native Rive cutout rig preserving the approved painted puppy artwork.
No bitmap pixel edits: mesh UVs address parts of the original alpha atlas.
Run with Python, then `rive scripts/pets/illustrated-puppy --verify/--once`.
"""
from pathlib import Path
import base64
import xml.etree.ElementTree as E
ROOT=Path(__file__).resolve().parents[2]
PROJECT=ROOT/'scripts/pets/illustrated-puppy'
r=E.Element('Rive',version='1',kind='fragment'); serial=1000

def el(p,tag,**attrs):
 global serial
 if 'id' not in attrs:serial+=1;attrs['id']=f'0:{serial}'
 return E.SubElement(p,tag,{k:str(v) for k,v in attrs.items()})

ab=el(r,'Artboard',id='0:1',name='Puppy',width=640,height=640,styleId='0:2',defaultStateMachineId='0:3',viewModelId='0:40',viewModelInstanceId='0:41')
el(ab,'LayoutComponentStyle',id='0:2',name='Puppy artboard')
# The single atlas is embedded once; UV quads keep real alpha and paint detail.
el(r,'ImageAsset',id='0:4',name='Painted puppy layers',file='../../../frontend/assets/pets/illustrated/puppy-parts-v1.png')

ARM_VERTICES={}
ANIMATIONS={}
def part(parent,name,pid,crop,anchor,pos,scale=1,asset='0:4',resolution=1280):
 n=el(parent,'Node',id=f'0:{pid}',name=name,x=pos[0],y=pos[1],scaleX=scale,scaleY=scale)
 if pid in [23,24,25,26]:n.set('opacity','0')
 image=el(n,'Image',assetId=asset,name=name+' paint',originX=0,originY=0)
 mesh=el(image,'Mesh',name=name+' UV cutout',triangleIndexBytes='AAECAAID')
 x,y,w,h=crop
 if pid in [12,13]:
  ys=[445,515,600,675,750,825]
  ring=[(0,0)]+[(j,1) for j in range(6)]+[(j,0) for j in range(5,0,-1)]
  indices={pair:k for k,pair in enumerate(ring)}
  triangles=[]; rows=[]
  for row,col in ring:
   xx=x+col*w; yy=ys[row]
   v=el(mesh,'ContourMeshVertex',x=xx-anchor[0],y=yy-anchor[1],u=xx/resolution,v=yy/resolution)
   rows.append((int(v.get('id').split(':')[1]),row,xx,yy,anchor))
  for j in range(5):
   a,b,c,d=[indices[z] for z in [(j,0),(j,1),(j+1,1),(j+1,0)]]
   triangles.extend([a,b,c,a,c,d])
  mesh.set('triangleIndexBytes',base64.b64encode(bytes(triangles)).decode())
  ARM_VERTICES[pid]=rows
 else:
  for xx,yy in [(x,y),(x+w,y),(x+w,y+h),(x,y+h)]:
   el(mesh,'ContourMeshVertex',x=xx-anchor[0],y=yy-anchor[1],u=xx/resolution,v=yy/resolution)
 return n

el(r,'ImageAsset',id='0:7',name='Authored paw replacement poses',file='../../../frontend/assets/pets/illustrated/puppy-paw-poses-v1.png')
el(r,'ImageAsset',id='0:8',name='Chest height paw inbetween',file='../../../frontend/assets/pets/illustrated/puppy-paw-mid-v2.png')
# Front-to-back source order in Rive. Food and paws can cross the muzzle.
food=el(ab,'Node',id='0:20',name='Held biscuit',x=320,y=430,opacity=0)
for x in [-10,0,10]:
 s=el(food,'Shape',x=x,y=0,name='Biscuit hole');el(s,'Ellipse',width=2.4,height=2.4,originX=.5,originY=.5)
 f=el(s,'Fill');el(f,'SolidColor',colorValue='FF95643C')
s=el(food,'Shape',name='Baked biscuit');el(s,'Rectangle',width=38,height=27,originX=.5,originY=.5,cornerRadiusTL=9)
f=el(s,'Fill');g=el(f,'LinearGradient',startX=-12,startY=-10,endX=15,endY=14)
el(g,'GradientStop',colorValue='FFE9C38A',position=0);el(g,'GradientStop',colorValue='FFC28C50',position=1)
# Purpose-drawn replacements preserve fur and rounded anatomy through a large bend.
mid=part(ab,'Chest paw drawing',26,(0,0,1254,1254),(627,500),(320,397),.24,asset='0:8',resolution=1254)
mid.set('scaleY','.20')
receive=part(ab,'Receive paw drawing',23,(650,20,610,590),(945,165),(320,397),.35,asset='0:7')
raised=part(ab,'Raised paw drawing',24,(10,640,625,365),(335,950),(320,430),.40,asset='0:7')
settle=part(ab,'Belly pat drawing',25,(650,650,600,550),(945,760),(320,397),.35,asset='0:7')
receive.set('scaleY','.30');raised.set('scaleY','.50');settle.set('scaleY','.30')
# Shoulder anchors are hidden by natural fur overlaps; no cut-out faces or photo.
armL=part(ab,'Left front paw',12,(550,445,240,380),(665,515),(255,397),.36)
armR=part(ab,'Right front paw',13,(900,445,235,380),(1020,515),(385,397),.36)
head=el(ab,'Node',id='0:10',name='Head pose',x=320,y=314)
look=el(head,'Node',id='0:16',name='Attention',rotation=0)
el(look,'DataBindContext',sourcePathIds='0:40-0:47',propertyKey=15)
for idx,pid in enumerate([30,31,32]):
 n=part(look,['Open eyes','Blink','Happy mouth'][idx],pid,(20+idx*426.6667,15,400,408),(220+idx*426.6667,340),(0,0),.70)
 if idx:n.set('opacity','0')
part(look,'Left caramel ear',14,(60,835,300,375),(265,890),(-95,-120),.54)
part(look,'Right cream ear',15,(520,835,290,354),(615,890),(94,-127),.55)
# Breathing pivot is at the ground so the hind paws remain planted.
body=part(ab,'Vest torso and hind paws',11,(10,425,485,400),(245,820),(320,580),.64)
tail=part(ab,'Fluffy tail',17,(870,850,350,370),(1040,1130),(210,530),.50)
shadow=el(ab,'Shape',name='Contact shadow',x=320,y=579)
el(shadow,'Ellipse',width=275,height=22,originX=.5,originY=.5)
f=el(shadow,'Fill');el(f,'SolidColor',colorValue='203F3525')
# Native events separate visual progress from host application state.
for eid,name in [(90,'foodTaken'),(91,'chewing'),(92,'feedComplete'),(93,'petComplete'),(94,'feedStart'),(95,'petStart')]:el(ab,'Event',id=f'0:{eid}',name=name)
sm=el(ab,'StateMachine',id='0:3',name='Care')
layer=el(sm,'StateMachineLayer',name='Character activity')
el(layer,'AnyState',x=200,y=-160);el(layer,'ExitState',x=420,y=-160)
ent=el(layer,'EntryState',x=0,y=0);el(ent,'StateTransition',stateToId='0:50')
# Public inputs: nearFood is reversible, feed/pet are consumable one-shot triggers.
def cond(t,name):
 c=el(t,'TransitionViewModelCondition');cp=el(c,'TransitionPropertyViewModelComparator')
 if name in ['feed','pet']:
  b=el(cp,'BindablePropertyTrigger');el(b,'DataBindContext',sourcePathIds=f'0:40-0:{45 if name=="feed" else 46}',propertyKey=686)
  el(c,'TransitionValueTriggerComparator')
 else:
  b=el(cp,'BindablePropertyBoolean');el(b,'DataBindContext',sourcePathIds='0:40-0:48',propertyKey=634)
  el(c,'TransitionValueBooleanComparator',value='true' if name=='near' else 'false')
def transition(s,to,condition=None,end=False):
 t=el(s,'StateTransition',stateToId=f'0:{50+to}',duration=120)
 if end:
  t.set('enableExitTime','true');t.set('exitTimeIsPercetange','true');t.set('exitTime','100')
 if condition:cond(t,condition)
 return t
for idx in range(6):
 st=el(layer,'AnimationState',id=f'0:{50+idx}',animationId=f'0:{60+idx}',x=220+idx*200,y=(idx%2)*150,reset='true')
 if idx in [0,1]:
  transition(st,2,'feed');transition(st,5,'pet');transition(st,1 if idx==0 else 0,'near' if idx==0 else 'far')
 elif idx in [2,3,4]:transition(st,idx+1 if idx<4 else 0,end=True)
 else:transition(st,0,end=True)
 if idx==2:el(st,'StateMachineFireEvent',eventId='0:94',occursValue='atStart')
 if idx==3:el(st,'StateMachineFireEvent',eventId='0:91',occursValue='atStart')
 if idx==4:el(st,'StateMachineFireEvent',eventId='0:92',occursValue='atEnd')
 if idx==5:
  el(st,'StateMachineFireEvent',eventId='0:95',occursValue='atStart')
  el(st,'StateMachineFireEvent',eventId='0:93',occursValue='atEnd')
# All timings below are authored for this character, not claimed industry rules.
BASE={10:{'y':300,'rotation':0},11:{'scaleY':.64},12:{'x':255,'y':397,'rotation':0,'opacity':1},13:{'x':385,'y':397,'rotation':0,'opacity':1},14:{'rotation':0},15:{'rotation':0},17:{'rotation':0},20:{'x':320,'y':430,'opacity':0,'rotation':0},30:{'opacity':1},31:{'opacity':0},32:{'opacity':0},23:{'opacity':0,'y':397},24:{'opacity':0,'y':430},25:{'opacity':0,'y':397},26:{'opacity':0,'y':397}}
def keys(a,obj,prop,values,hold=False):
 o=next((n for n in a if n.tag=='KeyedObject' and n.get('objectId')==f'0:{obj}'),None)
 if o is None:o=el(a,'KeyedObject',objectId=f'0:{obj}')
 p=el(o,'KeyedProperty',property=prop)
 for frame,value in values:
  k=el(p,'KeyFrameDouble',value=value,frame=frame,interpolationType='hold' if hold else 'cubic')
  if not hold:el(k,'CubicEaseInterpolator',x1=.42,y1=0,x2=.58,y2=1)
def animation(idx,name,duration,changes,loop=False):
 a=el(ab,'LinearAnimation',id=f'0:{60+idx}',name=name,fps=30,duration=duration,loopValue='loop' if loop else 'oneShot')
 for obj,props in BASE.items():
  for prop,val in props.items():
   seq=changes.get((obj,prop),[(0,val),(duration,val)])
   keys(a,obj,prop,seq,hold=(prop=='opacity'))
 ANIMATIONS[idx]=a
 return a
animation(0,'Idle breathing and blink',240,{
 (10,'y'):[(0,300),(60,298),(120,300),(180,298.5),(240,300)],
 (10,'rotation'):[(0,0),(75,-.018),(150,.012),(240,0)],
 (11,'scaleY'):[(0,.64),(60,.646),(120,.64),(180,.645),(240,.64)],
 (14,'rotation'):[(0,0),(70,.025),(130,-.018),(240,0)],
 (15,'rotation'):[(0,0),(80,-.018),(140,.025),(240,0)],
 (17,'rotation'):[(0,0),(70,.07),(120,-.04),(180,.06),(240,0)],
 (30,'opacity'):[(0,1),(70,0),(74,1),(188,0),(192,1),(240,1)],
 (31,'opacity'):[(0,0),(70,1),(74,0),(188,1),(192,0),(240,0)],
},True)
animation(1,'Notice food',60,{
 (10,'y'):[(0,300),(12,294),(60,294)],(10,'rotation'):[(0,0),(12,-.035),(60,-.035)],
 (12,'rotation'):[(0,0),(15,-.22),(60,-.22)],(13,'rotation'):[(0,0),(18,.2),(60,.2)],
 (17,'rotation'):[(0,0),(15,-.1),(30,.12),(45,-.1),(60,0)],
},True)
# Drawn elbow bends replace the resting paws; registration is applied below.
# The biscuit follows their contact point from lap to muzzle.
animation(2,'Receive and bring biscuit',27,{
 (10,'y'):[(0,294),(8,301),(20,307),(27,307)],
 (12,'x'):[(0,248),(12,268),(27,292)],(12,'y'):[(0,365),(12,378),(27,369)],
 (12,'rotation'):[(0,0),(9,-.72),(15,-1.8),(27,-2.46)],
 (13,'x'):[(0,394),(12,372),(27,348)],(13,'y'):[(0,362),(12,378),(27,369)],
 (13,'rotation'):[(0,0),(9,.72),(15,1.8),(27,2.46)],
 (20,'opacity'):[(0,0),(9,1),(27,1)],
 (20,'x'):[(0,320),(9,320),(15,320),(27,320)],
 (20,'y'):[(0,499),(14,499),(15,380),(20,380),(21,300),(27,300)],
 (14,'rotation'):[(0,0),(13,.08),(27,.02)],(15,'rotation'):[(0,0),(15,-.06),(27,0)],
})
# Discrete expression drawings preserve the painterly face rather than warping it.
animation(3,'Chew',54,{
 (10,'y'):[(0,307),(9,305),(18,307),(27,305),(36,307),(45,305),(54,307)],
 (12,'x'):[(0,292),(54,292)],(12,'y'):[(0,369),(54,369)],(12,'rotation'):[(0,-2.46),(54,-2.46)],
 (13,'x'):[(0,348),(54,348)],(13,'y'):[(0,369),(54,369)],(13,'rotation'):[(0,2.46),(54,2.46)],
 (20,'opacity'):[(0,1),(11,0),(54,0)],(20,'y'):[(0,300),(11,292),(54,292)],
 (30,'opacity'):[(0,0),(7,1),(14,0),(21,1),(28,0),(35,1),(42,0),(49,1),(54,1)],
 (32,'opacity'):[(0,1),(7,0),(14,1),(21,0),(28,1),(35,0),(42,1),(49,0),(54,0)],
 (17,'rotation'):[(0,0),(10,.1),(20,-.08),(30,.1),(40,-.08),(54,0)],
})
animation(4,'Satisfied and settle',36,{
 (10,'y'):[(0,307),(12,292),(23,298),(36,300)],(10,'rotation'):[(0,0),(15,-.06),(36,0)],
 (12,'x'):[(0,292),(18,248),(36,248)],(12,'y'):[(0,369),(36,365)],(12,'rotation'):[(0,-2.46),(20,-.1),(36,0)],
 (13,'x'):[(0,348),(18,394),(36,394)],(13,'y'):[(0,369),(36,362)],(13,'rotation'):[(0,2.46),(20,.1),(36,0)],
 (30,'opacity'):[(0,1),(8,0),(24,1),(36,1)],(31,'opacity'):[(0,0),(8,1),(24,0),(36,0)],
 (17,'rotation'):[(0,0),(7,.16),(14,-.13),(21,.14),(28,-.10),(36,0)],
 (14,'rotation'):[(0,0),(16,.10),(27,-.03),(36,0)],(15,'rotation'):[(0,0),(19,-.08),(30,.03),(36,0)],
})
animation(5,'Enjoy petting',45,{
 (10,'rotation'):[(0,0),(12,-.08),(30,-.06),(45,0)],(10,'y'):[(0,300),(14,307),(32,305),(45,300)],
 (30,'opacity'):[(0,1),(8,0),(33,1),(45,1)],(31,'opacity'):[(0,0),(8,1),(33,0),(45,0)],
 (14,'rotation'):[(0,0),(15,.12),(32,.06),(45,0)],(15,'rotation'):[(0,0),(18,-.1),(35,-.04),(45,0)],
 (17,'rotation'):[(0,0),(9,.1),(18,-.1),(27,.1),(36,-.1),(45,0)],
})
# Native replacement-pose animation: no extreme UV warping of painted arms.
for idx,a in ANIMATIONS.items():
 duration=int(a.get('duration'))
 for obj in a.findall('KeyedObject'):
  if obj.get('objectId')=='0:10':
   for prop in obj.findall('KeyedProperty'):
    if prop.get('property')=='y':
     for k in prop.findall('KeyFrameDouble'):k.set('value',str(float(k.get('value'))+14))
 # Keep resting paws fixed in every state; feeding uses the mouth and face.
 for pid in [12,13]:
  obj=next(o for o in a if o.tag=='KeyedObject' and o.get('objectId')==f'0:{pid}')
  for prop in list(obj):obj.remove(prop)
  for prop,val in BASE[pid].items():keys(a,pid,prop,[(0,val),(duration,val)])
 # User requested completely stationary front paws, including during feeding.
 # BASE keeps both resting drawings visible and every alternate drawing hidden.
 if idx==2:
  food_obj=next(o for o in a if o.tag=='KeyedObject' and o.get('objectId')=='0:20')
  for kp in list(food_obj):
   if kp.get('property')=='y':food_obj.remove(kp)
  keys(a,20,'y',[(0,300),(duration,300)])
  o=el(a,'KeyedObject',objectId='0:90');prop=el(o,'KeyedProperty',property='trigger')
  el(prop,'KeyFrameCallback',frame=9)
vm=el(r,'ViewModel',id='0:40',name='PuppyCare',defaultInstanceId='0:41')
for name,pid,typ in [('feed',45,'Trigger'),('pet',46,'Trigger'),('attention',47,'Number'),('nearFood',48,'Boolean')]:el(vm,'ViewModelProperty'+typ,name=name,id=f'0:{pid}')
inst=el(vm,'ViewModelInstance',id='0:41',name='Default',exports='true')
for pid,typ,val in [(45,'Trigger',0),(46,'Trigger',0),(47,'Number',0),(48,'Boolean','false')]:el(inst,'ViewModelInstance'+typ,viewModelPropertyId=f'0:{pid}',propertyValue=val)
# Explicit hit geometry is independent of texture UV mesh extents.
for hid,hy,hh in [(5,430,140),(6,245,150)]:
 hit=el(ab,'Shape',id=f'0:{hid}',name='Preview hit target',x=320,y=hy)
 el(hit,'Rectangle',width=140,height=hh,originX=.5,originY=.5)
 fill=el(hit,'Fill');el(fill,'SolidColor',colorValue='00FFFFFF')
 ab.remove(hit);ab.insert(0,hit)
# CLI pointer listeners make the native preview interactable too.
for name,propid in [('Head pose',46),('Vest torso and hind paws',45)]:
 image_id={'Head pose':'0:6','Vest torso and hind paws':'0:5'}[name]
 li=el(sm,'StateMachineListenerSingle',targetId=image_id,listenerTypeValue='click',name='Preview '+('pet' if propid==46 else 'feed'))
 change=el(li,'ListenerViewModelChange');bp=el(change,'BindablePropertyTrigger',propertyValue=1)
 el(bp,'DataBindContext',sourcePathIds=f'0:40-0:{propid}',propertyKey=686,direction='true')
E.indent(r)
E.ElementTree(r).write(PROJECT/'scene.rml',encoding='unicode')
print(PROJECT/'scene.rml')
