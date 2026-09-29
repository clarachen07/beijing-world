"""GLB 预览渲染: blender -b -P preview.py -- model1.glb model2.glb ..."""
import bpy, sys, os, math
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
for i, f in enumerate(argv):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=f)
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
    scene.render.resolution_x = 900
    scene.render.resolution_y = 700
    scene.render.image_settings.file_format = 'JPEG'
    scene.render.image_settings.quality = 85
    scene.render.filepath = f"refs/preview_{os.path.basename(f).replace('.glb', '')}.jpg"
    # 光照
    sun = bpy.data.lights.new("sun", 'SUN')
    sun.energy = 3.5
    so = bpy.data.objects.new("sun", sun)
    so.rotation_euler = (math.radians(50), 0, math.radians(-40))
    bpy.context.collection.objects.link(so)
    w = bpy.data.worlds.new("w")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.62, 0.72, 0.86, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = 1.1
    scene.world = w
    # 相机对准包围盒
    import mathutils
    bbox_min = mathutils.Vector((1e9, 1e9, 1e9))
    bbox_max = mathutils.Vector((-1e9, -1e9, -1e9))
    for o in bpy.data.objects:
        if o.type == 'MESH':
            for c in o.bound_box:
                wc = o.matrix_world @ mathutils.Vector(c)
                bbox_min = mathutils.Vector(map(min, bbox_min, wc))
                bbox_max = mathutils.Vector(map(max, bbox_max, wc))
    center = (bbox_min + bbox_max) / 2
    size = max((bbox_max - bbox_min).length, 1)
    cam = bpy.data.cameras.new("cam")
    cam.lens = 45
    co = bpy.data.objects.new("cam", cam)
    co.location = (center.x + size * 0.55, center.y - size * 0.85, center.z + size * 0.32)
    bpy.context.collection.objects.link(co)
    tgt = bpy.data.objects.new("tgt", None)
    tgt.location = center
    bpy.context.collection.objects.link(tgt)
    con = co.constraints.new('TRACK_TO')
    con.target = tgt
    scene.camera = co
    bpy.ops.render.render(write_still=True)
    print(f"PREVIEW {f} -> {scene.render.filepath} (size={size:.0f}m)")
