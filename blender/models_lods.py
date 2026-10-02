"""Re-export LODs from clean source blends, retaining the source envelope datum."""
import bpy,sys,json,math
from pathlib import Path
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'blender'))
import cnroof as c
import build_all as building
from materials import bake_materials
registry=json.loads((ROOT/'config/landmarks.json').read_text())['landmarks'];defs={d['model']:d for d in registry}
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
only=[arg for arg in args if not arg.startswith('--')] or list(defs)
def collision_primitives(name,target):
    gates={'tiananmen':(110,37,13,57.14,20.97,5),'zhengyangmen':(95,31.45,14.7,36.7,16.5,1),'jianlou':(52,28,12.6,36,21,1),'yongdingmen':(26,18,8,24,13,1),'shenwumen':(60,25,10,48,18,3),'donghuamen':(44,24,9,36,15,3),'xihuamen':(44,24,9,36,15,3),'taihemen':(55,25,3,44,18,3),'gulou':(56,33,24,43,24,1),'zhonglou':(32,32,31,29,22,1),'wumen':(126,30,12,60.05,25,3)}
    c.M['red']=next(iter(bpy.data.materials))
    if name=='wumen':
        pieces=building.wumen_podium()
        pieces.append(c.box('hall collision body',60.05,25,target-16,z=12))
        roof=c.hip_roof(58,27,4,seg_u=2,seg_v=2,flare=0);roof.location.z=target-4;pieces.append(roof)
        for x in [-52,52]:pieces.append(c.box('wing upper collision',18,65,12,x,-37,12))
        return pieces
    if name=='zhonglou':
        pieces=building.zhonglou_masonry()
        for w,d,z,h in [(34,27,35.5,3),(31,24,39,target-39)]:
            r=c.hip_roof(w,d,h,seg_u=2,seg_v=2,flare=0);r.location.z=z;pieces.append(r)
        return pieces
    if name in gates:
        w,d,h,hw,hd,arches=gates[name];pieces=building.arch_podium(w,d,h,arches,width=6,spring=min(5,h*.38))
        pieces.append(c.box('hall collision body',hw,hd,target-h-4,z=h))
        roof=c.hip_roof(hw+5,hd+5,4,seg_u=2,seg_v=2,flare=0);roof.location.z=target-4;pieces.append(roof)
        return pieces
    if name=='taihedian':
        pieces=[c.box('terrace collision',83-4*i,55-4*i,2.71,z=2.71*i) for i in range(3)]
        pieces.append(c.box('main hall collision',63.96,37.17,17.37,z=8.13))
        roof=c.hip_roof(54,29,target-25.5,top_w=30,seg_u=2,seg_v=2,flare=0);roof.location.z=25.5;pieces.append(roof);return pieces
    if name=='qiniandian':
        scale=31.6/32;body_z=lambda z:5.2+(z-6)*scale
        pieces=[c.cyl('base collision',r,5.2/3,z=i*5.2/3,seg=24) for i,r in enumerate([45.15,39.65,34.1])]
        pieces.append(c.cyl('hall collision',12,9.2*scale,z=5.2,seg=24))
        for r,z,h in [(16,15.2,4),(13.2,19.6,5.3),(10.8,25.3,9.6)]:pieces.append(c.cyl('roof collision',r,h*scale,z=body_z(z),seg=16,top_r=.6 if z>25 else r*.55))
        pieces.append(c.cyl('finial collision',.7,3.1*scale,z=body_z(34.9),seg=8,top_r=0));return pieces
    if name=='jiaolou':
        pieces=[c.box('corner base collision',25,25,10),c.box('corner body collision',14,14,6.7,z=10)]
        for z,w,d,h in [(16.7,28,24,2.8),(19.4,23,13,3),(22.4,16,8,5.1)]:
            roof=c.hip_roof(w,d,h,seg_u=2,seg_v=2,flare=0);roof.location.z=z;pieces.append(roof)
        return pieces
    if name=='birdnest':
        # Independent, bounded proxy: preserve the stadium roof hole and open
        # facade, rather than building a walking octree from thousands of members.
        pieces=[c.box('pitch collision floor',110,72,.7,z=0)];seg=32
        def annulus(name,rx0,ry0,rx1,ry1,z0,z1,thickness,wave=8):
            verts=[];faces=[]
            for drop in [0,thickness]:
                for rx,ry,base in [(rx0,ry0,z0),(rx1,ry1,z1)]:
                    verts.extend((rx*math.cos(i*math.tau/seg),ry*math.sin(i*math.tau/seg),base+wave*math.sin(i*math.tau/seg)**2-drop) for i in range(seg))
            for i in range(seg):
                j=(i+1)%seg
                faces.extend([(i,j,seg+j,seg+i),(2*seg+j,2*seg+i,3*seg+i,3*seg+j),(i,2*seg+i,2*seg+j,j),(seg+j,3*seg+j,3*seg+i,seg+i)])
            return c.new_mesh_obj(name,verts,faces)
        pieces.append(annulus('roof annulus collision',165.6,146.1,93.25,64.35,60,54,13))
        for rx0,ry0,rx1,ry1,z0,z1 in [(101.5,67.5,114.5,80.5,3.5,15.5),(117,83,125,91,18.5,31.5),(128,94,147,113,33,45)]:pieces.append(annulus('seating slope collision',rx0,ry0,rx1,ry1,z0,z1,.5,wave=6 if z0==33 else 0))
        for k in range(24):
            a=k*math.tau/24;bottom=(165.6*.94*math.cos(a),146.1*.94*math.sin(a),0);top=(165.6*math.cos(a),146.1*math.sin(a),60+8*math.sin(a)**2)
            pieces.append(c.beam('main support collision',bottom,top,1.2))
        return pieces
    return None
for name in only:
    bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets-source/blend'/f'{name}.blend'))
    meshes=[o for o in bpy.data.objects if o.type=='MESH'];main=next(o for o in meshes if o.name==name);coarse=next(o for o in meshes if o.name==name+' coarse')
    target=defs[name]['heightM'];stats=json.loads((ROOT/'assets-source/blend'/f'{name}.json').read_text())
    for level in (['collision'] if '--collision-only' in args else ['medium','far','collision']):
        source=main if level=='medium' else coarse
        copy=source.copy();copy.data=source.data.copy();copy.hide_render=False;copy.hide_viewport=False;bpy.context.collection.objects.link(copy)
        if level!='collision':
            n=len(source.data.polygons);ratio=1 if n<64 else .62 if level=='medium' else .4 if len(main.data.polygons)<1000 else .75 if n<1500 else .18
            if name=='linglong' and level=='far':ratio=.35
            bpy.ops.object.select_all(action='DESELECT');copy.select_set(True);bpy.context.view_layer.objects.active=copy
            mod=copy.modifiers.new('distance simplification','DECIMATE');mod.ratio=ratio;mod.use_collapse_triangulate=True;bpy.ops.object.modifier_apply(modifier=mod.name)
        elif defs[name].get('layout'):
            bpy.data.objects.remove(copy,do_unlink=True)
            c.M={m.name:m for m in bpy.data.materials}
            pieces=[]
            for b in defs[name]['layout']:
                if name=='yuetan' and b['name']=='钟楼':
                    proxy=building.arch_podium(max(3,b['w']-1.5),max(3,b['d']-1.5),3.8,width=3,spring=1.8)
                    proxy.append(c.box('clock upper collision',max(3,b['w']-1.5),max(3,b['d']-1.5),defs[name]['heightM']-3.8,z=3.8))
                    pieces+=building.move(proxy,b['x'],b['y'])
                else:pieces.append(c.box('building collision prism',max(3,b['w']-1),max(3,b['d']-1),b['heightM'],b['x'],b['y'],0))
            for altar in defs[name].get('altars',[]):pieces.append(c.box('altar collision',altar['w'],altar['d'],altar['heightM'],altar['x'],altar['y'],0))
            copy=c.join_objs(pieces,name+' collision')
        elif collision_primitives(name,target):
            bpy.data.objects.remove(copy,do_unlink=True)
            # The previous probe created these primitive objects; gather them once.
            pieces=[o for o in bpy.data.objects if o.type=='MESH' and o not in meshes]
            copy=c.join_objs(pieces,name+' collision')
        if level=='far':
            for i,original in enumerate(list(copy.data.materials)):
                flat=bpy.data.materials.new(original.name+' far');flat.use_nodes=True;flat.diffuse_color=original.diffuse_color
                bs=flat.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=original.diffuse_color;bs.inputs['Roughness'].default_value=.7;copy.data.materials[i]=flat
        if level=='collision':
            copy.data.materials.clear()
            for p in copy.data.polygons:p.material_index=0
        # Decimation can remove corner vertices. Preserve the original metre envelope and ground datum.
        lo=min(v.co.z for v in copy.data.vertices);hi=max(v.co.z for v in copy.data.vertices)
        for v in copy.data.vertices:v.co.z=(v.co.z-lo)*target/(hi-lo)
        copy.data.update();copy.data.validate();copy['lod']=level;copy['assetId']=name;copy['unit']='metre'
        c.export_glb(ROOT/'public/models/landmarks'/f'{name}-{level}.glb',copy);stats[level]=len(copy.data.polygons);bpy.data.objects.remove(copy,do_unlink=True)
    (ROOT/'assets-source/blend'/f'{name}.json').write_text(json.dumps(stats,indent=2)+'\n');print('LOD REPAIRED',name,flush=True)
