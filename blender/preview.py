"""Fixed, reproducible source-model renders (no decoder-dependent GLB import).
blender -b -P blender/preview.py -- taihedian qiniandian cctv
"""
import bpy,sys,math,json,os
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'assets-source/previews';OUT.mkdir(parents=True,exist_ok=True)
names=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else ['taihedian','qiniandian','cctv']
view=os.environ.get('MODEL_PREVIEW_VIEW','southeast');suffix='' if view=='southeast' else '-'+view
focus=os.environ.get('MODEL_PREVIEW_FOCUS','')
if focus:suffix+='-'+focus
for name in names:
    bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets-source/blend'/f'{name}.blend'))
    scene=bpy.context.scene
    for o in list(bpy.data.objects):
        if o.hide_render or o.type!='MESH':bpy.data.objects.remove(o,do_unlink=True)
    lo=Vector((float('inf'),)*3);hi=Vector((-float('inf'),)*3)
    for o in bpy.data.objects:
        for p in o.bound_box:
            v=o.matrix_world@Vector(p)
            for i in range(3):lo[i]=min(lo[i],v[i]);hi[i]=max(hi[i],v[i])
    extent=hi-lo;size=max(extent);center=(lo+hi)/2
    if focus:
        definitions=json.loads((ROOT/'config/landmarks.json').read_text())['landmarks']
        definition=next(d for d in definitions if d['model']==name)
        building_name={'biyong':'辟雍','yuetan-clock':'钟楼'}.get(focus)
        building=next(b for b in definition.get('layout',[]) if b['name']==building_name)
        center=Vector((building['x'],building['y'],building['heightM']/2));size=max(building['w'],building['d'],building['heightM'])+5
    world=bpy.data.worlds.new('Neutral sky');world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.55,.65,.8,1);world.node_tree.nodes['Background'].inputs[1].default_value=.7;scene.world=world
    light=bpy.data.lights.new('Sun','SUN');light.energy=3;light.angle=.08;sun=bpy.data.objects.new('Sun',light);scene.collection.objects.link(sun);sun.rotation_euler=(math.radians(28),math.radians(-18),math.radians(-30))
    camera=bpy.data.cameras.new('Fixed southeast camera');camera.type='ORTHO';camera.ortho_scale=size*1.85
    cam=bpy.data.objects.new('Fixed southeast camera',camera);scene.collection.objects.link(cam)
    cam.location=center+Vector((size*.8,-size*1.2,size*.65));cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler();scene.camera=cam
    if view=='top':
        cam.location=center+Vector((0,0,size*1.4));cam.rotation_euler=(0,0,0)
    elif view=='north':
        cam.location=center+Vector((size*.12,size*1.6,size*.45));cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler()
    # Presentation ground is external to the exported architectural geometry.
    bpy.ops.mesh.primitive_plane_add(size=size*4,location=(center.x,center.y,-.15))
    material=bpy.data.materials.new('Preview neutral ground');material.diffuse_color=(.25,.29,.26,1);bpy.context.object.data.materials.append(material)
    scene.render.engine='CYCLES';scene.cycles.samples=16;scene.cycles.use_denoising=True
    scene.render.resolution_x=1024;scene.render.resolution_y=768;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.render.filepath=str(OUT/f'{name}{suffix}.png')
    scene.view_settings.view_transform='AgX';bpy.ops.render.render(write_still=True)
    (OUT/f'{name}{suffix}.camera.json').write_text(json.dumps({'model':name,'view':view,'focus':focus or None,'projection':'orthographic','locationMeters':list(cam.location),'targetMeters':list(center),'orthographicScaleMeters':camera.ortho_scale,'resolution':[1024,768],'samples':16,'boundsBlenderXYZ':[list(lo),list(hi)]},indent=2)+'\n')
    print('RENDERED',name,flush=True)
