"""Rebuild the original, photo-ready puppy asset with Blender (no paid API).

Run: blender --background --python scripts/pets/build_dog.py
All geometry is authored here. Z-up Blender becomes Y-up in the exported GLB.
Keep named pivots: the web player animates body parts without distorting photos.
"""
import math
import random
from pathlib import Path

import bpy
from mathutils import Vector

random.seed(41)
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "frontend/assets/pets"
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)


def material(name, color, roughness=.93):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Specular IOR Level'].default_value = .18
    bsdf.inputs['Sheen Weight'].default_value = .24
    return mat


coat = material('Oatmeal short pile', (.64, .40, .19))
cream = material('Warm ivory fleece', (.91, .79, .58))
ear_mat = material('Honey ear fleece', (.48, .27, .115))
dark = material('Embroidered espresso', (.035, .022, .014), .68)
pink = material('Inner ear rose', (.47, .24, .19))
sage = material('Sage cotton bandana', (.22, .32, .23))
thread = material('Cotton seam', (.54, .62, .45))
ceramic = material('Stoneware feeding bowl', (.60, .67, .57), .75)
food_mat = material('Baked kibble', (.28, .12, .045))
ball_mat = material('Coral wool play ball', (.64, .24, .15))


def pivot(name, location, parent=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    if parent:
        world = obj.matrix_world.copy()
        obj.parent = parent
        obj.matrix_parent_inverse = parent.matrix_world.inverted()
    bpy.context.view_layer.update()
    return obj


def reparent(obj, parent):
    bpy.context.view_layer.update()
    world = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_world = world


def ellipsoid(name, loc, scale, mat, parent, rotation=(0, 0, 0), fur=0):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=40, ring_count=24, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.rotation_euler = rotation
    obj.data.materials.append(mat)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    reparent(obj, parent)
    if fur:
        fleece(obj, scale, mat, fur)
    return obj


def fleece(obj, scale, mat, count):
    """Tapered short-pile fibers: real silhouette detail, portable to glTF.

    Small flat bent ribbons avoid expensive runtime hair shaders and make a
    tactile surface under raking light. Deterministic, no external textures.
    """
    verts, faces = [], []
    sx, sy, sz = scale
    for _ in range(count):
        z = random.uniform(-1, 1)
        angle = random.uniform(0, math.tau)
        r = math.sqrt(1-z*z)
        p = Vector((sx*r*math.cos(angle), sy*r*math.sin(angle), sz*z))
        n = Vector((p.x/(sx*sx), p.y/(sy*sy), p.z/(sz*sz))).normalized()
        tangent = n.cross(Vector((.3, .8, .15))).normalized()
        length = random.uniform(.009, .024)
        width = random.uniform(.0015, .003)
        bend = Vector((0, .002, -.003))
        base = len(verts)
        verts.extend((p-tangent*width, p+tangent*width, p+n*length+bend))
        faces.append((base, base+1, base+2))
    mesh = bpy.data.meshes.new(obj.name + ' fibers')
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    fiber = bpy.data.objects.new(obj.name + '_pile', mesh)
    bpy.context.collection.objects.link(fiber)
    fiber.data.materials.append(mat)
    # Coordinates above already include ellipsoid scaling.
    fiber.location = obj.matrix_world.translation
    fiber.rotation_euler = obj.matrix_world.to_euler()
    reparent(fiber, obj.parent)
    for poly in mesh.polygons:
        poly.use_smooth = True


def tube(name, points, radius, mat, parent):
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '3D'
    curve.resolution_u = 12
    curve.bevel_depth = radius
    curve.bevel_resolution = 3
    spline = curve.splines.new('BEZIER')
    spline.bezier_points.add(len(points)-1)
    for bp, co in zip(spline.bezier_points, points):
        bp.co = co
        bp.handle_left_type = bp.handle_right_type = 'AUTO'
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    reparent(obj, parent)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target='MESH')
    obj.select_set(False)
    return obj


root = pivot('Puppy', (0, 0, 0))
body = pivot('Body', (0, 0, .62), root)
ellipsoid('Pear shaped torso', (0, .055, .78), (.43, .34, .59), coat, body, fur=3800)
ellipsoid('Ivory chest bib', (0, -.265, .85), (.29, .105, .36), cream, body, fur=2200)
for side in (-1, 1):
    ellipsoid('Seated haunch', (side*.34, .09, .34), (.265, .29, .29), coat, body, fur=1800)
    limb = pivot('PawL' if side < 0 else 'PawR', (side*.23, -.20, .57), body)
    ellipsoid('Foreleg', (side*.23, -.24, .41), (.13, .15, .32), coat, limb, rotation=(0, side*.1, 0), fur=1300)
    ellipsoid('Soft front paw', (side*.23, -.335, .145), (.165, .235, .125), cream, limb, fur=1200)
    for offset in (-.05, .05):
        tube('Toe seam', [(side*.23+offset, -.545, .16), (side*.23+offset, -.50, .205)], .004, ear_mat, limb)

tail = pivot('Tail', (.32, .24, .40), body)
tube('Curved plush tail', [(.32,.24,.4),(.63,.28,.40),(.75,.22,.59),(.69,.17,.76)], .10, coat, tail)
ellipsoid('Ivory tail tip', (.69,.17,.76), (.105,.105,.13), cream, tail, fur=1000)

head = pivot('Head', (0, -.015, 1.48), body)
ellipsoid('Round puppy head', (0,-.025,1.66), (.53,.39,.49), coat, head, fur=4800)
ellipsoid('Cream face surround', (0,-.305,1.63), (.435,.17,.405), cream, head, fur=2400)
for side in (-1, 1):
    ear = pivot('EarL' if side < 0 else 'EarR', (side*.45,-.01,1.94), head)
    ellipsoid('Floppy ear', (side*.51,-.01,1.60), (.175,.19,.415), ear_mat, ear,
              rotation=(0, side*-.20, side*-.08), fur=2600)
    ellipsoid('Ear inner fold', (side*.535,-.165,1.59), (.085,.035,.24), coat, ear, fur=600)

face = pivot('DefaultFace', (0,0,0), head)
for side in (-1, 1):
    ellipsoid('Gentle eye', (side*.175,-.454,1.765), (.034,.022,.042), dark, face)
    ellipsoid('Eye catchlight', (side*.175-.008,-.474,1.777), (.008,.004,.009), cream, face)
    ellipsoid('Muzzle', (side*.09,-.443,1.56), (.13,.075,.10), cream, face, fur=500)
ellipsoid('Velvet nose', (0,-.515,1.61), (.064,.036,.044), dark, face)
tube('Mouth', [(-.09,-.51,1.52),(-.04,-.53,1.50),(0,-.535,1.53),(.04,-.53,1.50),(.09,-.51,1.52)], .007, dark, face)

# Photo is a separate unlit, unwarped texture, never a generated human face.
mount = pivot('FaceMount', (0,-.51,1.665), head)
mount['photo_width'] = .68
mount['photo_height'] = .79

# Cloth collar and softly folded kerchief.
tube('Cotton collar', [(-.32,-.19,1.25),(0,-.35,1.23),(.32,-.19,1.25),(.32,.18,1.26),(0,.30,1.26),(-.32,.18,1.26),(-.32,-.19,1.25)], .047, sage, body)
mesh = bpy.data.meshes.new('Kerchief cloth')
mesh.from_pydata([(-.25,-.30,1.24),(.25,-.30,1.24),(.10,-.405,.94),(-.04,-.40,1.02),(0,-.37,1.20)], [], [(0,4,3),(4,2,3),(4,1,2)])
mesh.update()
scarf = bpy.data.objects.new('Folded sage bandana', mesh)
bpy.context.collection.objects.link(scarf)
scarf.data.materials.append(sage)
solid = scarf.modifiers.new('Cotton thickness','SOLIDIFY'); solid.thickness=.012
bevel = scarf.modifiers.new('Soft hems','BEVEL'); bevel.width=.018; bevel.segments=3
reparent(scarf, body)
tube('Bandana stitched hem',[(-.23,-.318,1.22),(-.025,-.417,1.04),(.095,-.421,.965),(.23,-.318,1.22)], .003, thread, body)

# Independent props are hidden until the corresponding real care request succeeds.
bowl = pivot('FoodBowl', (0,0,0))
bpy.ops.mesh.primitive_torus_add(major_radius=.19, minor_radius=.035, major_segments=48, minor_segments=12, location=(0,-.65,.12))
rim=bpy.context.object; rim.name='Rounded stoneware rim'; rim.data.materials.append(ceramic); reparent(rim,bowl)
ellipsoid('Stoneware bowl', (0,-.65,.065), (.22,.22,.08), ceramic, bowl)
for _ in range(18):
    a=random.uniform(0, math.tau); r=random.uniform(0,.15)
    ellipsoid('Kibble', (math.cos(a)*r,-.65+math.sin(a)*r,.12), (.027,.021,.018), food_mat, bowl)
ball=pivot('PlayBall',(0,0,0))
ellipsoid('Wool ball', (.50,-.50,.14), (.14,.14,.14), ball_mat,ball,fur=1200)
tube('Ball stitched seam',[(.50,-.64,.14),(.50,-.60,.24),(.50,-.50,.28),(.50,-.40,.24)],.004,cream,ball)

bpy.ops.object.select_all(action='DESELECT')
for obj in bpy.context.scene.objects:
    if obj.type in {'MESH', 'EMPTY'}:
        obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'puppy.glb'), export_format='GLB', use_selection=True,
                          export_apply=True, export_animations=False, export_extras=True)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'scripts/pets/puppy.blend'))
print('PUPPY_ASSET_READY', OUT/'puppy.glb')
