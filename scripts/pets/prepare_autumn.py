"""Adapt Blender Studio's CC-BY Autumn into a self-contained web character.

blender -b --disable-autoexec --python scripts/pets/prepare_autumn.py -- /path/to/autumn.blend
Source: https://studio.blender.org/characters/autumn/v1/
The authored silhouette, UVs, colors and fur clumps are retained. Film rig and
particle systems are replaced by a small skinning rig and groomed alpha cards.
"""
import bisect
import math
import random
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(sys.argv[sys.argv.index('--')+1])
OUT = ROOT/'frontend/assets/pets'
SCALE = 5.1
random.seed(73)
bpy.ops.wm.open_mainfile(filepath=str(SOURCE), load_ui=False, use_scripts=False)
bpy.context.scene.render.use_simplify=False
source_rig = bpy.data.objects['RIG-autumn']
bone_locations = {b.name: (source_rig.matrix_world@b.head_local, source_rig.matrix_world@b.tail_local) for b in source_rig.data.bones}
body_source = bpy.data.objects['GEO_autumn_body']
eye_centers={side:bpy.data.objects['GEO_autumn_eye.'+side.lower()].location.copy()*SCALE for side in ('L','R')}


def newmat(name, rgb, roughness=.9):
    m=bpy.data.materials.new(name);m.diffuse_color=(*rgb,1);m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value=(*rgb,1)
    bs.inputs['Roughness'].default_value=roughness
    bs.inputs['Specular IOR Level'].default_value=.2
    return m


color_image = bpy.data.images.load(str(SOURCE.parent/'char/autumn/maps/TEX_autumn_body_color.png'), check_existing=False)
color_image.scale(1024,1024)
color_image.pack()
color_pixels=np.array(color_image.pixels[:],dtype=np.float32).reshape(1024,1024,4)
coat = newmat('Autumn authored coat',(.12,.10,.08),.94)
nodes=coat.node_tree.nodes;bs=nodes.get('Principled BSDF')
tex=nodes.new('ShaderNodeTexImage');tex.image=color_image
coat.node_tree.links.new(tex.outputs['Color'],bs.inputs['Base Color'])
bs.inputs['Sheen Weight'].default_value=.3
scarfmat=newmat('Autumn woven terracotta',(.29,.045,.025),.95)
black=newmat('Soft black eyes',(.012,.008,.005),.23)
brown=newmat('Amber iris',(.18,.065,.018),.31)
white=newmat('Warm eye whites',(.90,.86,.78),.35)
ivory=newmat('Teeth',(.72,.65,.52),.7)

# A compact deform rig with proper vertex skinning, not disconnected spheres.
mapping=[('Body','spine_2_def',None),('Neck','neck_1_def','Body'),('Head','head_def_mstr','Neck'),
         ('Tail','tail_1_def','Body'),('TailMid','tail_3_def','Tail'),('TailTip','tail_6_def','TailMid')]
for side in ('L','R'):
    mapping.extend([(f'Ear{side}',f'ear_1_{side}','Head'),(f'EarTip{side}',f'ear_3_{side}',f'Ear{side}'),
                    (f'Paw{side}',f'arm_def_{side}','Body'),(f'Forearm{side}',f'forearm_def_{side}',f'Paw{side}'),
                    (f'Foot{side}',f'hand_def_{side}',f'Forearm{side}'),
                    (f'Hind{side}',f'thigh_def_{side}','Body'),(f'Shin{side}',f'shin_def_{side}',f'Hind{side}'),
                    (f'HindFoot{side}',f'foot_def_{side}',f'Shin{side}')])
arm=bpy.data.armatures.new('Autumn web skeleton')
rig=bpy.data.objects.new('Autumn',arm);bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig;rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for name,source,parent in mapping:
    b=arm.edit_bones.new(name)
    head,tail=bone_locations[source]
    b.head=head*SCALE;b.tail=tail*SCALE
    if (b.tail-b.head).length<.02:b.tail=b.head+Vector((0,0,.04))
    if parent:b.parent=arm.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')


def group_target(name):
    side='L' if name.endswith('_L') or '_L.' in name else 'R'
    low=name.lower()
    if name not in source_rig.data.bones or not source_rig.data.bones[name].use_deform:return None
    if 'ear' in low:return ('EarTip' if any(s in low for s in ('_3','_4')) else 'Ear')+side
    if 'tail' in low:
        return 'TailTip' if any(str(i) in low for i in (5,6)) else 'TailMid' if any(str(i) in low for i in (3,4)) else 'Tail'
    if any(s in low for s in ('fing','hand','carpal')):return 'Foot'+side
    if any(s in low for s in ('forearm','wrist','elbow')):return 'Forearm'+side
    if any(s in low for s in ('clavi','arm_','shoulder')):return 'Paw'+side
    if any(s in low for s in ('toe_','foot_','tarsal','fetlock')):return 'HindFoot'+side
    if any(s in low for s in ('shin','hock','knee')):return 'Shin'+side
    if any(s in low for s in ('thigh','buttock','hip_')):return 'Hind'+side
    if 'neck' in low:return 'Neck'
    if any(s in low for s in ('spine','pelvis','back_fix','chest','scarf')):return 'Body'
    return 'Head'


def skin_clone(source, force=None, subd=False):
    obj=source.copy();obj.data=source.data.copy();bpy.context.collection.objects.link(obj)
    obj.animation_data_clear()
    obj.hide_viewport=False;obj.hide_render=False;obj.hide_set(False)
    if obj.data.shape_keys:obj.shape_key_clear()
    for mod in list(obj.modifiers):obj.modifiers.remove(mod)
    weights=[]
    oldgroups={g.index:group_target(g.name) for g in source.vertex_groups}
    for v in obj.data.vertices:
        w={}
        for g in v.groups:
            target=force or oldgroups.get(g.group)
            if target and g.weight>1e-6:w[target]=w.get(target,0)+g.weight
        if force:w={force:1}
        if not w:
            co=(source.matrix_world@v.co)*SCALE
            fallback='Head' if co.z>1.28 and co.y<-.30 else 'Neck' if co.z>1 and co.y<-.30 else 'Body'
            if co.z<.78:
                side='L' if co.x>0 else 'R'
                fallback=('Forearm' if co.y<0 else 'Shin')+side
            w={fallback:1}
        w=dict(sorted(w.items(),key=lambda it:-it[1])[:4]);total=sum(w.values())
        weights.append({k:v/total for k,v in w.items()})
        v.co=(source.matrix_world@v.co)*SCALE
    obj.matrix_world=Matrix.Identity(4)
    obj.vertex_groups.clear()
    groups={name:obj.vertex_groups.new(name=name) for name,_,_ in mapping}
    for i,w in enumerate(weights):
        for name,value in w.items():groups[name].add([i],value,'REPLACE')
    # Modest subdivision rounds the authored silhouette; skinning stays portable.
    if subd:
        mod=obj.modifiers.new('Web silhouette subdivision','SUBSURF');mod.levels=1
        bpy.context.view_layer.objects.active=obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
    mod=obj.modifiers.new('Web armature','ARMATURE');mod.object=rig
    obj.parent=rig;obj.matrix_parent_inverse=rig.matrix_world.inverted()
    obj.hide_render=False;obj.hide_viewport=False;obj.hide_set(False)
    for poly in obj.data.polygons:poly.use_smooth=True
    return obj


keep=[rig]
body=skin_clone(body_source,subd=True);body.name='Autumn body'
keep.append(body)
for slot in body.material_slots:slot.link='DATA';slot.material=coat

def bone_parent(obj,bone):
    bpy.context.view_layer.update();world=obj.matrix_world.copy()
    obj.parent=rig;obj.parent_type='BONE';obj.parent_bone=bone
    bpy.context.view_layer.update();obj.matrix_world=world


default_face=bpy.data.objects.new('DefaultFace',None);bpy.context.collection.objects.link(default_face)
bone_parent(default_face,'Head');keep.append(default_face)
for name in ('GEO_autumn_fur_brows','GEO_autumn_fur_nose'):
    source=bpy.data.objects[name]
    eye='eye.' in name
    obj=skin_clone(source,force='Head' if eye else 'Body' if 'scarf' in name else None,subd='scarf' in name)
    obj.name=name.replace('GEO_autumn_','Autumn ')
    for slot in obj.material_slots:
        mat=slot.material
        replacement=scarfmat if 'scarf' in name else (white if 'white' in mat.name else brown if 'brown' in mat.name else black) if eye else coat
        slot.link='DATA';slot.material=replacement
    if eye:
        for modifier in list(obj.modifiers):obj.modifiers.remove(modifier)
        # The head bone drives both the original eyes and the optional photo mount.
        world=obj.matrix_world.copy();obj.parent=default_face;obj.matrix_world=world
    keep.append(obj)


def sphere(name,center,scale,material,parent):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=20,location=center)
    obj=bpy.context.object;obj.name=name;obj.scale=scale
    obj.data.materials.append(material)
    for poly in obj.data.polygons:poly.use_smooth=True
    bpy.context.view_layer.update()
    world=obj.matrix_world.copy();obj.parent=parent;obj.matrix_world=world
    keep.append(obj);return obj


for side in ('L','R'):
    source=bpy.data.objects['GEO_autumn_eye.'+side.lower()]
    center=eye_centers[side]+Vector((0,-.045,-.09))
    eye=bpy.data.objects.new('Eye'+side,None);bpy.context.collection.objects.link(eye)
    eye.location=center
    bpy.context.view_layer.update();world=eye.matrix_world.copy();eye.parent=default_face;eye.matrix_world=world
    keep.append(eye)
    sphere('Eyeball '+side,center,(.13,.085,.13),white,eye)
    sphere('Amber iris '+side,center+Vector((0,-.090,0)),(.095,.027,.105),brown,eye)
    sphere('Pupil '+side,center+Vector((0,-.120,0)),(.050,.014,.070),black,eye)
    sphere('Eye glint '+side,center+Vector((-.030,-.137,.046)),(.023,.009,.025),white,eye)

# The source film kerchief depends on its own control rig. Rebuild the cloth at
# the web rest pose so it stays around the neck, rather than at the film origin.
curve=bpy.data.curves.new('Soft cloth collar','CURVE');curve.dimensions='3D';curve.bevel_depth=.042;curve.bevel_resolution=3
path=curve.splines.new('BEZIER');path.bezier_points.add(7)
for i,point in enumerate(path.bezier_points):
    angle=i*math.tau/8;point.co=(math.cos(angle)*.29,-.46+math.sin(angle)*.23,1.12)
    point.handle_left_type=point.handle_right_type='AUTO'
path.use_cyclic_u=True
collar=bpy.data.objects.new('Autumn soft collar',curve);bpy.context.collection.objects.link(collar);collar.data.materials.append(scarfmat)
bone_parent(collar,'Body');keep.append(collar)
bpy.context.view_layer.objects.active=collar;collar.select_set(True);bpy.ops.object.convert(target='MESH');collar.select_set(False)
clothmesh=bpy.data.meshes.new('Folded web kerchief')
clothmesh.from_pydata([(-.25,-.65,1.12),(.25,-.65,1.12),(.07,-.76,.83),(-.11,-.74,.93),(0,-.72,1.05)],[],[(0,4,3),(4,2,3),(4,1,2)])
clothmesh.update();cloth=bpy.data.objects.new('Autumn kerchief',clothmesh);bpy.context.collection.objects.link(cloth);cloth.data.materials.append(scarfmat)
solid=cloth.modifiers.new('Cloth thickness','SOLIDIFY');solid.thickness=.015
bevel=cloth.modifiers.new('Soft cloth hems','BEVEL');bevel.width=.024;bevel.segments=3
bone_parent(cloth,'Body');keep.append(cloth)

# Alpha hair cards retain direction and clumping while avoiding film hair systems.
atlas=bpy.data.images.new('Autumn web fur atlas',width=128,height=256,alpha=True)
pixels=np.zeros((256,128,4),dtype=np.float32);pixels[:,:,:3]=1
for strand in range(16):
    root=random.uniform(8,120);width=random.uniform(.5,1.3);curve=random.uniform(-12,12)
    for y in range(256):
        t=y/255
        x=root+curve*t*t+math.sin(t*math.pi)*random.uniform(-.3,.3)
        fade=min(1,(1-t)*9)
        for ix in range(max(0,int(x-3)),min(128,int(x+4))):
            alpha=math.exp(-((ix-x)/width)**2)*fade
            pixels[y,ix,3]=max(pixels[y,ix,3],alpha)
atlas.pixels.foreach_set(pixels.ravel());atlas.pack()
furmat=newmat('Autumn groomed hair cards',(.12,.10,.08),.95)
nodes=furmat.node_tree.nodes;bs=nodes.get('Principled BSDF');links=furmat.node_tree.links
vertex=nodes.new('ShaderNodeVertexColor');vertex.layer_name='RootColor';links.new(vertex.outputs['Color'],bs.inputs['Base Color'])
alpha=nodes.new('ShaderNodeTexImage');alpha.image=atlas;links.new(alpha.outputs['Alpha'],bs.inputs['Alpha'])
bs.inputs['Sheen Weight'].default_value=.35
furmat.surface_render_method='DITHERED';furmat.use_backface_culling=False
mesh=body.data;mesh.calc_loop_triangles()
triangles=list(mesh.loop_triangles);areas=[];total=0
for tri in triangles:total+=tri.area;areas.append(total)
verts=[];faces=[];uvs=[];colors=[];cardweights=[]
groupnames={g.index:g.name for g in body.vertex_groups}
uvlayer=mesh.uv_layers.active.data
for _ in range(6500):
    tri=triangles[bisect.bisect_left(areas,random.random()*total)]
    a,b,c=[mesh.vertices[index] for index in tri.vertices]
    u=random.random();v=random.random()
    if u+v>1:u,v=1-u,1-v
    bary=(1-u-v,u,v)
    p=sum((vert.co*w for vert,w in zip((a,b,c),bary)),Vector())
    n=sum((vert.normal*w for vert,w in zip((a,b,c),bary)),Vector()).normalized()
    # Leave eyes, nose and paw undersides legible rather than covering everything.
    if p.z<.06 or (p.y<-.98 and p.z<1.54):continue
    uv=sum((uvlayer[li].uv*w for li,w in zip(tri.loops,bary)),Vector((0,0)))
    color=color_pixels[int(uv.y*1023)%1024,int(uv.x*1023)%1024,:3]
    # Artist texture is sRGB; glTF vertex colors are linear.
    color=np.where(color<=.04045,color/12.92,((color+.055)/1.055)**2.4)
    # Fur follows the body and gravity, with coherent low-frequency clumping.
    flow=Vector((p.x*.12,.35,-1)) if p.z<1.45 else Vector((p.x*.22,.55,-.32))
    tangent=flow-n*flow.dot(n)
    if tangent.length<.02:tangent=Vector((1,0,0)).cross(n)
    tangent.normalize();side=tangent.cross(n).normalized()
    length=random.uniform(.045,.12)*(1.25 if p.z>1.6 else 1)
    width=random.uniform(.018,.032)
    w={}
    for vert,bw in zip((a,b,c),bary):
        for g in vert.groups:
            key=groupnames[g.group];w[key]=w.get(key,0)+g.weight*bw
    w=dict(sorted(w.items(),key=lambda it:-it[1])[:4]);weighttotal=sum(w.values());w={k:v/weighttotal for k,v in w.items()}
    base=len(verts)
    for segment,t in enumerate((0,.33,.68,1)):
        center=p+n*(.004+length*.30*t)+tangent*length*t
        for sign in (-1,1):
            verts.append(center+side*sign*width*(1-t*.6))
            uvs.append(((sign+1)/2,t));colors.append((*color,1));cardweights.append(w)
        if segment:
            i=base+segment*2;faces.extend([(i-2,i-1,i+1),(i-2,i+1,i)])
furmesh=bpy.data.meshes.new('Groomed surface cards');furmesh.from_pydata(verts,[],faces);furmesh.update()
cards=bpy.data.objects.new('Autumn groomed fur',furmesh);bpy.context.collection.objects.link(cards)
cards.data.materials.append(furmat)
layer=furmesh.uv_layers.new(name='FurUV')
cl=furmesh.color_attributes.new(name='RootColor',type='FLOAT_COLOR',domain='CORNER')
for loop in furmesh.loops:
    layer.data[loop.index].uv=uvs[loop.vertex_index];cl.data[loop.index].color=colors[loop.vertex_index]
groups={name:cards.vertex_groups.new(name=name) for name,_,_ in mapping}
for i,w in enumerate(cardweights):
    for name,value in w.items():groups[name].add([i],value,'REPLACE')
mod=cards.modifiers.new('Fur follows skin','ARMATURE');mod.object=rig
cards.parent=rig;keep.append(cards)

mount=bpy.data.objects.new('FaceMount',None);bpy.context.collection.objects.link(mount)
mount.location=(0,-1.46,1.55);bone_parent(mount,'Head')
mount['photo_width']=.83;mount['photo_height']=.94;keep.append(mount)

# Retain real props from the original prototype, outside the character skeleton.
with bpy.data.libraries.load(str(ROOT/'scripts/pets/puppy.blend'),link=False) as (available,selected):
    selected.objects=[name for name in available.objects if name in ('FoodBowl','PlayBall') or any(s in name for s in ('Stoneware','stoneware','Kibble','Wool ball','Ball stitched'))]
for obj in selected.objects:
    if obj:
        bpy.context.collection.objects.link(obj);keep.append(obj)
        if obj.type=='MESH' and obj.name.startswith('Kibble'):
            mod=obj.modifiers.new('Small prop budget','DECIMATE');mod.ratio=.08
            bpy.context.view_layer.objects.active=obj
            bpy.ops.object.modifier_apply(modifier=mod.name)
for obj in keep:
    if obj.name in ('FoodBowl','PlayBall'):
        obj.location.y-=1

for old_action in list(bpy.data.actions):bpy.data.actions.remove(old_action)

# Five real skinning clips. Anticipation -> action -> delayed ear/tail follow-through -> settle.
rig.animation_data_create()
moving=['Head','Neck','EarL','EarR','EarTipL','EarTipR','Tail','TailMid','TailTip','PawL','PawR','ForearmL','ForearmR','FootL','FootR','Body']
durations={'Idle':4.0,'Feed':2.8,'Wipe':2.0,'Play':2.1,'Tap':1.4}
for action_name,duration in durations.items():
    action=bpy.data.actions.new(action_name);action.use_fake_user=True;rig.animation_data.action=action
    for frame in range(0,round(duration*30)+1,2):
        t=frame/30;p=t/duration;env=math.sin(math.pi*p)**2
        for pose in rig.pose.bones:pose.rotation_mode='XYZ';pose.rotation_euler=(0,0,0);pose.location=(0,0,0)
        def turn(name,x=0,y=0,z=0):rig.pose.bones[name].rotation_euler=(x,y,z)
        if action_name=='Idle':
            turn('Head',z=math.sin(p*math.tau)*.055)
            turn('Tail',z=math.sin(p*math.tau*2)*.18)
            turn('TailMid',z=math.sin(p*math.tau*2-.4)*.12)
            turn('EarL',x=math.sin(p*math.tau-.35)*.025)
            turn('EarR',x=math.sin(p*math.tau-.6)*.025)
        elif action_name=='Feed':
            anticipation=-.11*math.sin(min(p/.18,1)*math.pi) if p<.18 else 0
            eating=max(0,math.sin(math.pi*max(0,(p-.15)/.85)))
            turn('Neck',x=anticipation+eating*.35)
            turn('Head',x=eating*(.48+math.sin(t*12)*.045))
            turn('EarL',x=eating*.12+math.sin(t*8-.5)*env*.035)
            turn('EarR',x=eating*.10+math.sin(t*8-.8)*env*.035)
            turn('Tail',z=math.sin(t*9)*env*.25)
        elif action_name=='Wipe':
            turn('Head',z=math.sin(t*17)*env*.24)
            turn('Neck',z=math.sin(t*17-.3)*env*.06)
            turn('EarL',x=math.sin(t*17-.9)*env*.24)
            turn('EarR',x=-math.sin(t*17-1.2)*env*.24)
            turn('EarTipL',x=math.sin(t*17-1.4)*env*.17)
            turn('EarTipR',x=-math.sin(t*17-1.7)*env*.17)
        else:
            lift=math.sin(math.pi*p)**2
            turn('Head',z=-lift*.12,x=-lift*.08)
            turn('PawR',x=-lift*.50);turn('ForearmR',x=lift*.55)
            turn('FootR',x=-lift*.16)
            turn('EarL',x=math.sin(t*10-.6)*env*.09)
            turn('EarR',x=math.sin(t*10-.9)*env*.09)
            turn('Tail',z=math.sin(t*13)*env*.40)
            turn('TailMid',z=math.sin(t*13-.6)*env*.25)
            turn('TailTip',z=math.sin(t*13-1)*env*.18)
        for name in moving:rig.pose.bones[name].keyframe_insert(data_path='rotation_euler',frame=frame,group=name)
    # Key exact end even for odd frame counts.
    if action_name!='Idle':
        for name in moving:
            rig.pose.bones[name].rotation_euler=(0,0,0)
            rig.pose.bones[name].keyframe_insert(data_path='rotation_euler',frame=round(duration*30),group=name)
rig.animation_data.action=None
for pose in rig.pose.bones:pose.rotation_euler=(0,0,0)

# Delete film controls, background, original particles and unused source rig.
for obj in list(bpy.data.objects):
    if obj not in keep:bpy.data.objects.remove(obj,do_unlink=True)
for collection in bpy.data.collections:
    collection.hide_viewport=False;collection.hide_render=False
for obj in keep:obj.hide_render=False;obj.hide_viewport=False;obj.hide_set(False)
scene=bpy.context.scene;scene.render.fps=30;scene.frame_set(0)
scene['asset_credit']='Autumn © Blender Foundation | studio.blender.org | CC-BY-4.0; adapted for web skinning, hair cards and care animations.'
rig['asset_version']=2
rig['credit']=scene['asset_credit']
rig['photo_width']=.83;rig['photo_height']=.94
# The derivative contains no film scripting or unused 4K film materials.
scene.world=bpy.data.worlds.new('Autumn Web Studio')
scene.world.use_nodes=True
scene.world.node_tree.nodes.get('Background').inputs['Color'].default_value=(.25,.25,.25,1)
scene.world.node_tree.nodes.get('Background').inputs['Strength'].default_value=.5
used_materials={slot.material for obj in keep if obj.type=='MESH' for slot in obj.material_slots}
for mat in list(bpy.data.materials):
    if mat not in used_materials:bpy.data.materials.remove(mat,do_unlink=True)
for text in list(bpy.data.texts):bpy.data.texts.remove(text)
used_images={node.image for mat in used_materials if mat and mat.node_tree for node in mat.node_tree.nodes if node.type=='TEX_IMAGE' and node.image}
for image in list(bpy.data.images):
    if image not in used_images:bpy.data.images.remove(image,do_unlink=True)
for blocks in (bpy.data.meshes,bpy.data.curves,bpy.data.armatures,bpy.data.lattices,bpy.data.node_groups,bpy.data.images):
    for block in list(blocks):
        if not block.library:block.use_fake_user=False
        if block.users==0:blocks.remove(block)
bpy.ops.outliner.orphans_purge(do_local_ids=True,do_linked_ids=True,do_recursive=True)
bpy.ops.object.select_all(action='DESELECT')
for obj in keep:obj.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.export_scene.gltf(filepath=str(OUT/'autumn.glb'),export_format='GLB',use_selection=True,
                         export_extras=True,export_animations=True,export_animation_mode='ACTIONS',
                         export_force_sampling=True,export_frame_step=2,export_def_bones=True)
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'scripts/pets/autumn-web.blend'))
print('AUTUMN_WEB_READY',OUT/'autumn.glb')
