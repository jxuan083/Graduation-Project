"""Author the comparison character as native, script-free Rive RML.
Run python3 scripts/pets/build_rive_mvp.py, then rive scripts/pets/rive-mvp --once.
"""
from pathlib import Path
import xml.etree.ElementTree as E
ROOT = Path(__file__).resolve().parents[2]
out = ROOT / 'scripts/pets/rive-mvp/scene.rml'
r = E.Element('Rive', version='1', kind='fragment')
i = 100

def el(p, tag, **attrs):
    global i
    if 'id' not in attrs:
        i += 1
        attrs['id'] = f'0:{i}'
    return E.SubElement(p, tag, {k: str(v) for k,v in attrs.items()})

ab = el(r,'Artboard',id='0:2',name='Companion',width=500,height=500,styleId='0:5',defaultStateMachineId='0:7',viewModelId='0:40',viewModelInstanceId='0:41')
el(ab,'LayoutComponentStyle',id='0:5',name='Stage')

def oval(p,name,x,y,w,h,colors,rotation=0):
    s=el(p,'Shape',name=name,x=x,y=y,rotation=rotation)
    el(s,'Ellipse',name='Contour',width=w,height=h,originX=.5,originY=.5)
    f=el(s,'Fill',name='Paint')
    if isinstance(colors,str): el(f,'SolidColor',colorValue=colors)
    else:
        g=el(f,'LinearGradient',startX=-w*.2,startY=-h*.4,endX=w*.35,endY=h*.5)
        for j,c in enumerate(colors): el(g,'GradientStop',colorValue=c,position=j/(len(colors)-1))
    return s

# Rive paints FIRST sibling on top. Head stays fixed to keep the original photo rigid.
head=el(ab,'Node',name='Photo hood',x=250,y=180)
oval(head,'Eye highlight L',-25,-6,4,4,'FFFFFFFF')
oval(head,'Eye highlight R',25,-6,4,4,'FFFFFFFF')
oval(head,'Eye L',-27,-3,10,13,'FF47392F')
oval(head,'Eye R',27,-3,10,13,'FF47392F')
oval(head,'Nose',0,19,15,10,'FF47392F')
oval(head,'Blush L',-43,18,18,9,'FFE6AD91')
oval(head,'Blush R',43,18,18,9,'FFE6AD91')
oval(head,'Face opening',0,0,134,148,['FFFFF5DA','FFF1DBB7'])
oval(head,'Opening seam',0,2,145,158,'FFC29161')
oval(head,'Hood',0,0,205,190,['FFFFDEA0','FFD69A59'])
# Costume feature: visible species change is driven by data, not a different bitmap.
cat=el(ab,'Node',name='Cat ears',opacity=0,id='0:60')
el(cat,'DataBindContext',sourcePathIds='0:40-0:46',propertyKey=18)
for x,rot in [(171,-.25),(329,.25)]:
    s=el(cat,'Shape',name='Cat ear',x=x,y=111,rotation=rot)
    el(s,'Triangle',width=62,height=78,originX=.5,originY=.5)
    f=el(s,'Fill');el(f,'SolidColor',colorValue='FFDEAA6F')
dog=el(ab,'Node',name='Dog ears',id='0:61')
el(dog,'DataBindContext',sourcePathIds='0:40-0:47',propertyKey=18)
earL=el(dog,'Node',name='Left ear pivot',x=158,y=142,id='0:10',rotation=.18)
oval(earL,'Inner ear',0,25,35,87,['FFBD8758','FF9D6846'])
oval(earL,'Floppy ear',0,20,57,113,['FFD7A469','FFAC7347'])
earR=el(dog,'Node',name='Right ear pivot',x=342,y=142,id='0:11',rotation=-.18)
oval(earR,'Inner ear',0,25,35,87,['FFBD8758','FF9D6846'])
oval(earR,'Floppy ear',0,20,57,113,['FFD7A469','FFAC7347'])
body=el(ab,'Node',name='Body',x=250,y=349,id='0:12')
# Shirt uses color data binding; face is deliberately never a skinned mesh.
oval(body,'Ivory collar',0,-58,70,17,'FFFFEBD0')
for by in [-30,-10]: oval(body,'Button',0,by,6,6,'FFFFEBD0')
oval(body,'Pocket',28,9,25,23,'FFFFEBD0')
shirt=oval(body,'Shirt',0,-5,126,125,'FF708B77')
color=shirt.find('Fill/SolidColor')
el(color,'DataBindContext',sourcePathIds='0:40-0:48',propertyKey=37)
oval(body,'Ivory collar',0,-58,70,17,'FFFFEBD0')
oval(body,'Pocket',17,9,26,23,'66FFFFFF')
oval(body,'Torso',0,0,132,158,['FFF6C987','FFD69C61'])
for x in [-48,48]:
    oval(ab,'Paw pad',250+x,427,37,19,'FFE6BD88')
    oval(ab,'Foot',250+x,423,72,49,['FFFFDFA4','FFDAA365'])
for idx,(x,rot) in enumerate([(185,-.24),(315,.24)]):
    arm=el(ab,'Node',name='Arm',id=f'0:{13+idx}',x=x,y=307,rotation=rot)
    oval(arm,'Mitten',0,38,39,67,['FFFFDCA0','FFD9A063'])
tail=el(ab,'Node',id='0:15',name='Tail',x=315,y=384,rotation=.65)
oval(tail,'Tail tip',0,-37,38,76,['FFFFD99A','FFCF9457'])
oval(ab,'Ground shadow',250,451,184,16,'243D4231')
# Native VM-controlled state machine: no unsigned scripts in web assets.
sm=el(ab,'StateMachine',id='0:7',name='Care')
layer=el(sm,'StateMachineLayer',name='Care actions')
el(layer,'AnyState',x=220,y=-160)
el(layer,'ExitState',x=440,y=-160)
entry=el(layer,'EntryState',x=0,y=0);el(entry,'StateTransition',stateToId='0:20')
for n in range(3):
    state=el(layer,'AnimationState',id=f'0:{20+n}',animationId=f'0:{30+n}',x=220+n*220,y=n*80,reset='true')
    for m in range(3):
        if m==n:continue
        t=el(state,'StateTransition',stateToId=f'0:{20+m}',duration=160)
        c=el(t,'TransitionViewModelCondition')
        cp=el(c,'TransitionPropertyViewModelComparator');bp=el(cp,'BindablePropertyNumber')
        el(bp,'DataBindContext',sourcePathIds='0:40-0:45',propertyKey=636)
        el(c,'TransitionValueNumberComparator',value=m)

def key(anim,obj,prop,values):
    o=el(anim,'KeyedObject',objectId=f'0:{obj}');p=el(o,'KeyedProperty',property=prop)
    for f,v in values:
        k=el(p,'KeyFrameDouble',value=v,frame=f,interpolationType='cubic')
        el(k,'CubicEaseInterpolator',x1=.42,y1=0,x2=.58,y2=1)
for n,name in enumerate(['Idle','Feed','Pet']):
    a=el(ab,'LinearAnimation',id=f'0:{30+n}',name=name,fps=30,duration=60,loopValue='loop')
    key(a,12,'y',[(0,349),(30,346 if n==0 else 341),(60,349)])
    key(a,10,'rotation',[(0,.18),(15,.28 if n==0 else .46),(30,.18),(45,.08),(60,.18)])
    key(a,11,'rotation',[(0,-.18),(15,-.08),(30,-.18),(45,-.3 if n==0 else -.5),(60,-.18)])
    key(a,15,'rotation',[(0,.65),(10,.5),(20,.8),(30,.5),(40,.8),(50,.5),(60,.65)])
    for arm,base in [(13,-.24),(14,.24)]:
        sign=1 if arm==13 else -1
        v=[(0,base),(30,base+.06*sign),(60,base)] if n==0 else [(0,base),(12,base+.85*sign),(24,base+(.65 if n==1 else 1.2)*sign),(36,base+.85*sign),(48,base+.65*sign),(60,base)]
        key(a,arm,'rotation',v)
vm=el(r,'ViewModel',name='Companion',id='0:40',defaultInstanceId='0:41')
for name,pid,typ in [('action',45,'Number'),('cat',46,'Number'),('dog',47,'Number'),('shirtColor',48,'Color')]:
    el(vm,'ViewModelProperty'+typ,name=name,id=f'0:{pid}')
v=el(vm,'ViewModelInstance',name='Default',exports='true',id='0:41')
for pid,typ,val in [(45,'Number',0),(46,'Number',0),(47,'Number',1),(48,'Color','FF708B77')]:
    el(v,'ViewModelInstance'+typ,viewModelPropertyId=f'0:{pid}',propertyValue=val)
E.indent(r)
E.ElementTree(r).write(out,encoding='unicode')
print(out)
