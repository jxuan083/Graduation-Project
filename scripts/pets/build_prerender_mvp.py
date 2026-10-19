"""Render fixed-camera costume bodies; save head anchors separately from photos.
Blender CLI: blender -b --python scripts/pets/build_prerender_mvp.py -- [--all]
"""
import bpy, math, json, sys
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'frontend/assets/pets/mvp/frames'
OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene
scene.render.engine='CYCLES';scene.cycles.samples=8
scene.cycles.use_denoising=True
scene.render.resolution_x=320;scene.render.resolution_y=320;scene.render.resolution_percentage=100
scene.render.film_transparent=True
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
scene.world.color=(.8,.8,.8)
scene.view_settings.view_transform='Standard'

def mat(name,color):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
 s=m.node_tree.nodes.get('Principled BSDF');s.inputs['Base Color'].default_value=(*color,1)
 s.inputs['Roughness'].default_value=.91;s.inputs['Specular IOR Level'].default_value=.15
 return m
coat=mat('Honey cotton',(.78,.48,.20));cream=mat('Ivory fabric',(.94,.80,.55));earmat=mat('Caramel ear',(.47,.26,.12));sage=mat('Sage cotton',(.28,.41,.31));rose=mat('Terracotta cotton',(.60,.27,.20));dark=mat('Embroidery',(.07,.045,.027));white=mat('Glint',(.95,.95,.9))
def ell(name,xyz,size,material):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=40,ring_count=24,location=xyz)
 o=bpy.context.object;o.name=name;o.scale=size;o.data.materials.append(material)
 for p in o.data.polygons:p.use_smooth=True
 return o
ell('Torso',(0,0,1.48),(.65,.46,.80),coat)
shirt=ell('Sweater',(0,-.12,1.63),(.64,.43,.62),sage)
ell('Collar',(0,-.23,2.17),(.35,.30,.07),cream)
for x in [-.48,.48]:
 ell('Foot',(x,-.12,.55),(.36,.48,.24),coat)
 ell('Paw sole',(x,-.5,.58),(.21,.08,.10),cream)
head=ell('Hood',(0,0,3.2),(1.025,.65,.95),coat)
ell('Hood seam',(0,-.585,3.2),(.73,.12,.80),earmat)
ell('Face window',(0,-.69,3.2),(.67,.08,.74),cream)
for x in [-.27,.27]:
 ell('Eye',(x,-.77,3.23),(.045,.03,.06),dark)
 ell('Eye glint',(x-.01,-.798,3.25),(.012,.012,.016),white)
ell('Nose',(0,-.78,3.02),(.075,.03,.05),dark)
ear=[]
for x in [-.95,.95]:
 o=ell('Floppy ear',(x,0,3.15),(.28,.26,.59),earmat);o.rotation_euler[1]=.18 if x<0 else -.18;ear.append(o)
# Cat ear alternative is authored in 3D too, not painted over frames.
cat=[]
for x in [-.76,.76]:
 bpy.ops.mesh.primitive_cone_add(vertices=3,radius1=.38,radius2=.065,depth=.65,location=(x,0,3.99),rotation=(0,0,math.pi/6))
 o=bpy.context.object;o.name='Cat ear';o.data.materials.append(coat)
 bevel=o.modifiers.new('Soft seam','BEVEL');bevel.width=.13;bevel.segments=4
 o.modifiers.new('Weighted normals','WEIGHTED_NORMAL');cat.append(o)
arms=[]
for x in [-.67,.67]:
 o=ell('Mitten arm',(x,-.03,1.67),(.22,.29,.46),coat);arms.append(o)
tail=ell('Tail',(.81,.17,1.05),(.21,.23,.48),coat)
tail.rotation_euler[1]=.6
# Separate shirt meshes and round buttons for readable wardrobe differences.
for x in [-.12,.12]:ell('Collar stitch',(x,-.53,2.10),(.11,.04,.045),cream)
for z in [1.85,1.66]:ell('Sweater button',(0,-.55,z),(.035,.025,.035),cream)
ell('Pocket',( .28,-.52,1.59),(.13,.04,.13),cream)
for loc,energy,size in [((-3,-5,7),450,5),((4,-2,5),180,4),((0,3,6),250,3)]:
 bpy.ops.object.light_add(type='AREA',location=loc);l=bpy.context.object;l.data.energy=energy;l.data.shape='DISK';l.data.size=size
 l.rotation_euler=(Vector((0,0,2))-l.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(0,-14,2.5));cam=bpy.context.object;cam.rotation_euler=(math.pi/2,0,0);cam.data.type='ORTHO';cam.data.ortho_scale=5;scene.camera=cam
pet_only='--pet-only' in sys.argv
allframes='--all' in sys.argv or pet_only
manifest={'fps':12,'width':320,'height':320,'photo':{'x':.5,'y':.36,'width':.236,'height':.268},'variants':{}}
if pet_only:
 manifest['variants']=json.loads((OUT.parent/'frames.json').read_text())['variants']
variants=[('dog','sage',sage),('dog','rose',rose),('cat','sage',sage),('cat','rose',rose)]
for species,outfit,material in variants if allframes else variants[:1]:
 shirt.data.materials[0]=material
 for o in ear:o.hide_render=species!='dog'
 for o in cat:o.hide_render=species!='cat'
 for action in (['pet'] if pet_only else ['idle','feed','pet']) if allframes else ['idle']:
  paths=[]
  for frame in range(24) if allframes else [0]:
   t=frame/24*math.tau;wave=math.sin(t)
   shirt.location.z=1.63+.025*wave
   tail.rotation_euler[1]=.6+.3*math.sin(t*3)
   for j,o in enumerate(ear):o.rotation_euler[1]=(1 if j==0 else -1)*(.18+.06*wave+( .12*math.sin(t*2) if action!='idle' else 0))
   for j,o in enumerate(arms):
    side=-1 if j==0 else 1
    raised=(.5-.5*math.cos(t)) if action=='feed' else ((.22+.18*math.sin(t*2)) if j==0 else (.35+.3*math.sin(t*2))) if action=='pet' else 0
    o.location.x=side*(.67-.12*raised);o.location.y=-.03-.35*raised;o.location.z=1.67+.45*raised
    o.rotation_euler[1]=side*(.12+.6*raised);o.rotation_euler[0]=-.5*raised
   name=f'{species}-{outfit}-{action}-{frame:02}.png'
   scene.render.filepath=str(OUT/name);bpy.ops.render.render(write_still=True);paths.append(name)
  manifest['variants'][f'{species}-{outfit}-{action}']=paths
(OUT.parent/'frames.json').write_text(json.dumps(manifest,separators=(',',':')))
if not allframes:bpy.ops.wm.save_as_mainfile(filepath='/tmp/pet-costume-mvp.blend')
