"""Native Rive cutout rig preserving the approved painted puppy artwork.
No bitmap pixel edits: mesh UVs address parts of the original alpha atlas.
Run with Python, then `rive scripts/pets/illustrated-puppy --verify/--once`.
"""
from pathlib import Path
import base64
import sys
import xml.etree.ElementTree as E
ROOT=Path(__file__).resolve().parents[2]
PROJECT=ROOT/'scripts/pets/illustrated-puppy'
sys.path.insert(0,str(ROOT/'backend'))
from pet_care import FOOD_CROPS, TOY_CROPS
r=E.Element('Rive',version='1',kind='fragment'); serial=1000

def el(p,tag,**attrs):
 global serial
 if 'id' not in attrs:serial+=1;attrs['id']=f'0:{serial}'
 return E.SubElement(p,tag,{k:str(v) for k,v in attrs.items()})

ab=el(r,'Artboard',id='0:1',name='Puppy',width=640,height=640,styleId='0:2',defaultStateMachineId='0:3',viewModelId='0:40',viewModelInstanceId='0:41')
el(ab,'LayoutComponentStyle',id='0:2',name='Puppy artboard')
# The single atlas is embedded once; UV quads keep real alpha and paint detail.
el(r,'ImageAsset',id='0:4',name='Painted puppy layers',file='../../../frontend/assets/pets/illustrated/puppy-parts-v1.png')

for aid,name,file in [(7,'Cloth ball','puppy-cloth-ball-v1.png'),(8,'Food atlas','care-foods-v1.png'),(9,'Toy atlas','care-toys-v1.png')]:
 el(r,'ImageAsset',id=f'0:{aid}',name=name,file='../../../frontend/assets/pets/illustrated/'+file)

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

# Front-to-back source order in Rive. Food and paws can cross the muzzle.
food=el(ab,'Node',id='0:20',name='Meal',x=320,y=430,opacity=0)
def item_part(parent,name,pid,crop,asset,size,propid):
 x,y,w,h=[v*1254 for v in crop]
 n=part(parent,name,pid,(x,y,w,h),(x+w/2,y+h/2),(0,0),size/max(w,h),asset=asset,resolution=1254)
 n.set('opacity','1' if propid in [300,309] else '0')
 el(n,'DataBindContext',sourcePathIds=f'0:40-0:{propid}',propertyKey=18)
for i,crop in enumerate(FOOD_CROPS):item_part(food,f'Food {i}',200+i,crop,'0:8',43,300+i)
# Persistent props keep their resting position after play; paws remain stationary.
ball=el(ab,'Node',id='0:21',name='Selected toy',x=480,y=580,opacity=1)
item_part(ball,'Cloth ball',209,(0,0,1,1),'0:7',94,309)
for i,crop in enumerate(TOY_CROPS):item_part(ball,f'Toy {i}',210+i,crop,'0:9',88,310+i)
contact=el(ab,'Node',id='0:18',name='Toy contact',x=480,y=615,opacity=1)
shape=el(contact,'Shape',name='Soft toy shadow')
el(shape,'Ellipse',width=61,height=8,originX=.5,originY=.5)
fill=el(shape,'Fill');el(fill,'SolidColor',colorValue='293F3525')
bubbles=el(ab,'Node',id='0:22',name='Cleaning bubbles',x=320,y=250,opacity=0)
for x,y,size in [(-72,-38,16),(65,-55,12),(-86,4,10),(83,-8,19)]:
 shape=el(bubbles,'Shape',x=x,y=y,name='Soap bubble')
 el(shape,'Ellipse',width=size,height=size,originX=.5,originY=.5)
 fill=el(shape,'Fill');el(fill,'SolidColor',colorValue='88CAE0DC')
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
for eid,name in [(90,'foodTaken'),(91,'chewing'),(92,'feedComplete'),(93,'petComplete'),(94,'feedStart'),(95,'petStart'),(96,'wipeStart'),(97,'wipeComplete'),(98,'playStart'),(99,'playComplete')]:el(ab,'Event',id=f'0:{eid}',name=name)
sm=el(ab,'StateMachine',id='0:3',name='Care')
layer=el(sm,'StateMachineLayer',name='Character activity')
el(layer,'AnyState',x=200,y=-160);el(layer,'ExitState',x=420,y=-160)
ent=el(layer,'EntryState',x=0,y=0);el(ent,'StateTransition',stateToId='0:50')
# Public inputs: nearFood is reversible, feed/pet are consumable one-shot triggers.
def cond(t,name):
 c=el(t,'TransitionViewModelCondition');cp=el(c,'TransitionPropertyViewModelComparator')
 if name in ['feed','pet','wipe','play','playTug','playBounce','playToss']:
  property_id={'feed':45,'pet':46,'wipe':49,'play':44,'playTug':320,'playBounce':321,'playToss':322}[name]
  b=el(cp,'BindablePropertyTrigger');el(b,'DataBindContext',sourcePathIds=f'0:40-0:{property_id}',propertyKey=686)
  el(c,'TransitionValueTriggerComparator')
 else:
  b=el(cp,'BindablePropertyBoolean');el(b,'DataBindContext',sourcePathIds='0:40-0:48',propertyKey=634)
  el(c,'TransitionValueBooleanComparator',value='true' if name=='near' else 'false')
STATE_IDS={**{i:50+i for i in range(8)},8:80,9:81,10:82}
def transition(s,to,condition=None,end=False):
 t=el(s,'StateTransition',stateToId=f'0:{STATE_IDS[to]}',duration=120)
 if end:
  t.set('enableExitTime','true');t.set('exitTimeIsPercetange','true');t.set('exitTime','100')
 if condition:cond(t,condition)
 return t
for idx in range(11):
 st=el(layer,'AnimationState',id=f'0:{STATE_IDS[idx]}',animationId=f'0:{60+idx}',x=220+idx*200,y=(idx%2)*150,reset='true')
 if idx in [0,1]:
  transition(st,2,'feed');transition(st,5,'pet');transition(st,6,'wipe');transition(st,7,'play');transition(st,8,'playTug');transition(st,9,'playBounce');transition(st,10,'playToss');transition(st,1 if idx==0 else 0,'near' if idx==0 else 'far')
 elif idx in [2,3,4]:transition(st,idx+1 if idx<4 else 0,end=True)
 else:transition(st,0,end=True)
 if idx==2:el(st,'StateMachineFireEvent',eventId='0:94',occursValue='atStart')
 if idx==3:el(st,'StateMachineFireEvent',eventId='0:91',occursValue='atStart')
 if idx==4:el(st,'StateMachineFireEvent',eventId='0:92',occursValue='atEnd')
 if idx in [5,6,7,8,9,10]:
  el(st,'StateMachineFireEvent',eventId=f'0:{ {5:95,6:96,7:98,8:98,9:98,10:98}[idx]}',occursValue='atStart')
  el(st,'StateMachineFireEvent',eventId=f'0:{ {5:93,6:97,7:99,8:99,9:99,10:99}[idx]}',occursValue='atEnd')
# All timings below are authored for this character, not claimed industry rules.
BASE={10:{'y':300,'rotation':0},11:{'scaleY':.64},12:{'x':255,'y':397,'rotation':0,'opacity':1},13:{'x':385,'y':397,'rotation':0,'opacity':1},14:{'rotation':0},15:{'rotation':0},17:{'rotation':0},20:{'x':320,'y':430,'opacity':0,'rotation':0},18:{'x':480,'y':615,'scaleX':1,'opacity':1},21:{'x':480,'y':580,'rotation':0,'opacity':1},22:{'y':250,'opacity':0},30:{'opacity':1},31:{'opacity':0},32:{'opacity':0}}
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
animation(6,'Gentle face clean',54,{
 (10,'rotation'):[(0,0),(12,-.045),(25,.045),(39,-.02),(54,0)],
 (30,'opacity'):[(0,1),(8,0),(42,1),(54,1)],(31,'opacity'):[(0,0),(8,1),(42,0),(54,0)],
 (14,'rotation'):[(0,0),(18,.06),(35,-.03),(54,0)],(15,'rotation'):[(0,0),(18,-.04),(35,.04),(54,0)],
 (22,'opacity'):[(0,0),(7,1),(44,0),(54,0)],(22,'y'):[(0,265),(24,240),(54,220)],
})
def toy_animation(idx,name,xs,ys,rotations):
 changes={
  (10,'rotation'):[(0,0),(18,.055),(42,-.055),(60,.025),(78,0)],
  (17,'rotation'):[(0,0),(12,.12),(24,-.12),(36,.12),(48,-.12),(60,.07),(78,0)],
  (21,'x'):xs,(21,'y'):ys,(21,'rotation'):rotations,
  (18,'x'):xs,
  (18,'scaleX'):[(f,max(.55,1-(580-y)/150)) for f,y in ys],
 }
 animation(idx,name,78,changes)
toy_animation(7,'Roll and settle',[(0,480),(20,190),(43,440),(59,400),(69,480),(78,480)],
 [(0,580),(20,574),(43,580),(59,578),(69,580),(78,580)],
 [(0,0),(20,-8.8),(43,-1.2),(59,-2.4),(69,0),(78,0)])
toy_animation(8,'Tug and release',[(0,480),(16,452),(28,474),(40,451),(52,478),(66,480),(78,480)],
 [(0,580),(16,565),(28,576),(40,568),(52,578),(78,580)],
 [(0,0),(16,-.18),(28,.12),(40,-.14),(52,.08),(66,0),(78,0)])
toy_animation(9,'Bounce and settle',[(0,480),(22,448),(44,460),(62,480),(78,480)],
 [(0,580),(12,538),(22,580),(34,555),(44,580),(54,570),(62,580),(78,580)],
 [(0,0),(12,-.12),(22,.08),(34,-.07),(44,.04),(62,0),(78,0)])
toy_animation(10,'Toss and return',[(0,480),(20,200),(43,420),(60,460),(70,480),(78,480)],
 [(0,580),(12,470),(20,510),(32,480),(43,555),(60,568),(70,580),(78,580)],
 [(0,0),(20,-6.28),(43,-12.56),(60,-6.28),(70,0),(78,0)])
# All care animations retain the fixed resting front paws.

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
 # Freeze the torso too: its painted shoulder fur must not breathe under fixed paws.
 torso=next(o for o in a if o.tag=='KeyedObject' and o.get('objectId')=='0:11')
 for kp in torso.findall('KeyedProperty'):
  if kp.get('property')=='scaleY':
   for k in kp.findall('KeyFrameDouble'):k.set('value','.64')
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
for name,pid,typ in [('feed',45,'Trigger'),('pet',46,'Trigger'),('wipe',49,'Trigger'),('play',44,'Trigger'),('playTug',320,'Trigger'),('playBounce',321,'Trigger'),('playToss',322,'Trigger'),('attention',47,'Number'),('nearFood',48,'Boolean')]:el(vm,'ViewModelProperty'+typ,name=name,id=f'0:{pid}')
for i in range(16):el(vm,'ViewModelPropertyNumber',name=f'food{i}' if i<9 else f'toy{i-9}',id=f'0:{300+i}')
inst=el(vm,'ViewModelInstance',id='0:41',name='Default',exports='true')
for pid,typ,val in [(45,'Trigger',0),(46,'Trigger',0),(49,'Trigger',0),(44,'Trigger',0),(320,'Trigger',0),(321,'Trigger',0),(322,'Trigger',0),(47,'Number',0),(48,'Boolean','false')]:el(inst,'ViewModelInstance'+typ,viewModelPropertyId=f'0:{pid}',propertyValue=val)
for i in range(16):el(inst,'ViewModelInstanceNumber',viewModelPropertyId=f'0:{300+i}',propertyValue=1 if i in [0,9] else 0)
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
