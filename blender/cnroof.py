"""Meter-based meshes: Blender X east, Y north, Z up; glTF Y up."""
import bpy,bmesh,math
from mathutils import Vector
M={}
def new_mesh_obj(name,verts,faces,mat=None):
    clean=[]
    for face in faces:
        unique=[]
        for i in face:
            if not unique or (Vector(verts[i])-Vector(verts[unique[-1]])).length>1e-6:unique.append(i)
        if len(unique)>2 and (Vector(verts[unique[0]])-Vector(verts[unique[-1]])).length<1e-6:unique.pop()
        if len(unique)>=3:
            a=Vector(verts[unique[0]])
            if sum((Vector(verts[unique[k]])-a).cross(Vector(verts[unique[k+1]])-a).length for k in range(1,len(unique)-1))>1e-7:clean.append(unique)
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],clean);mesh.validate();mesh.update()
    obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj)
    if mat:mesh.materials.append(mat)
    return planar_uv(obj)
def planar_uv(obj):
    uv=obj.data.uv_layers.active or obj.data.uv_layers.new(name='UVMap')
    for p in obj.data.polygons:
        for li in p.loop_indices:
            v=obj.data.vertices[obj.data.loops[li].vertex_index].co
            if abs(p.normal.z)>.65:uv.data[li].uv=(v.x/4,v.y/4)
            elif abs(p.normal.y)>.65:uv.data[li].uv=(v.x/4,v.z/4)
            else:uv.data[li].uv=(v.y/4,v.z/4)
    return obj
def box(name,sx,sy,sz,x=0,y=0,z=0,mat=None):
    verts=[(a*sx/2,b*sy/2,cc*sz/2) for cc in [-1,1] for b in [-1,1] for a in [-1,1]]
    obj=new_mesh_obj(name,verts,[(0,2,3,1),(4,5,7,6),(0,1,5,4),(2,6,7,3),(0,4,6,2),(1,3,7,5)],mat)
    obj.location=(x,y,z+sz/2);return obj
def cyl(name,r,h,x=0,y=0,z=0,seg=32,mat=None,top_r=None):
    rt=r if top_r is None else top_r
    verts=[(rr*math.cos(i*math.tau/seg),rr*math.sin(i*math.tau/seg),zz) for rr,zz in [(r,-h/2),(rt,h/2)] for i in range(seg)]
    faces=[tuple(reversed(range(seg))),tuple(seg+i for i in range(seg))]
    faces.extend((i,(i+1)%seg,seg+(i+1)%seg,seg+i) for i in range(seg))
    obj=new_mesh_obj(name,verts,faces,mat);obj.location=(x,y,z+h/2);return obj
def beam(name,a,b,width,mat=None,round=False):
    a,b=Vector(a),Vector(b);d=b-a
    obj=cyl(name,width/2,d.length,seg=8,mat=mat) if round else box(name,width,width,d.length,mat=mat)
    obj.location=(a+b)/2;obj.rotation_mode='QUATERNION';obj.rotation_quaternion=d.to_track_quat('Z','Y');return obj
def tube(name,r,h,x=0,y=0,z=0,seg=32,mat=None):
    verts=[]
    for zz,rr in [(z,r),(z+h,r),(z,r-.12),(z+h,r-.12)]:verts.extend([(x+rr*math.cos(i*math.tau/seg),y+rr*math.sin(i*math.tau/seg),zz) for i in range(seg)])
    faces=[]
    for i in range(seg):
        j=(i+1)%seg;faces.extend([(i,j,seg+j,seg+i),(2*seg+j,2*seg+i,3*seg+i,3*seg+j),(seg+i,seg+j,3*seg+j,3*seg+i),(j,i,2*seg+i,2*seg+j)])
    return new_mesh_obj(name,verts,faces,mat)
def hip_roof(w,d,h,top_w=None,top_d=0,seg_u=16,seg_v=8,flare=.6,mat=None,name='roof',gable=False):
    """Four real curved slopes, rather than the old diagonal ribbon."""
    top_w=w*.42 if top_w is None else top_w
    bottom=[(-w/2,-d/2),(w/2,-d/2),(w/2,d/2),(-w/2,d/2)];top=[(-top_w/2,-top_d/2),(top_w/2,-top_d/2),(top_w/2,top_d/2),(-top_w/2,top_d/2)]
    verts=[];faces=[]
    for side in range(4):
        start=len(verts);a,b=bottom[side],bottom[(side+1)%4];c,dd=top[side],top[(side+1)%4]
        for iv in range(seg_v+1):
            t=iv/seg_v
            for iu in range(seg_u+1):
                u=iu/seg_u;xx=(a[0]*(1-u)+b[0]*u)*(1-t)+(c[0]*(1-u)+dd[0]*u)*t;yy=(a[1]*(1-u)+b[1]*u)*(1-t)+(c[1]*(1-u)+dd[1]*u)*t
                zz=h*t**1.45+flare*abs(2*u-1)**4*(1-t)**3;verts.append((xx,yy,zz))
        for iv in range(seg_v):
            for iu in range(seg_u):
                a=start+iv*(seg_u+1)+iu;faces.append((a,a+1,a+seg_u+2,a+seg_u+1))
    obj=new_mesh_obj(name,verts,faces,mat);solid=obj.modifiers.new('roof thickness','SOLIDIFY');solid.thickness=.12;solid.offset=-1
    if gable:
        for sign in [-1,1]:
            x=sign*top_w/2;panel=new_mesh_obj(name+' gable',[(x,-d*.2,h*.5),(x,d*.2,h*.5),(x,0,h)],[(0,1,2)],M.get('red',mat));panel.parent=obj
    return obj
def conic_roof(r_bottom,r_top,h,seg=72,eave_lift=.15,mat=None,name='conic'):
    verts=[];faces=[];nv=14
    for k in range(nv+1):
        t=k/nv;r=r_bottom*(1-t)+r_top*t;zz=h*t**1.45+eave_lift*(1-t)**4;verts.extend([(r*math.cos(i*math.tau/seg),r*math.sin(i*math.tau/seg),zz) for i in range(seg)])
    for k in range(nv):
        for i in range(seg):
            j=(i+1)%seg;faces.append((k*seg+i,k*seg+j,(k+1)*seg+j,(k+1)*seg+i))
    obj=new_mesh_obj(name,verts,faces,mat);solid=obj.modifiers.new('roof thickness','SOLIDIFY');solid.thickness=.12;solid.offset=-1;return obj
def railing(w,d,z,mat,x=0,y=0,gap=3):
    objs=[]
    for side in [-1,1]:
        nx=max(2,math.ceil(w/gap));ny=max(2,math.ceil(d/gap))
        for i in range(nx+1):objs.append(box('baluster',.22,.22,1.05,x-w/2+i*w/nx,y+side*d/2,z,mat))
        objs.append(box('stone handrail',w,.18,.16,x,y+side*d/2,z+.82,mat))
        for i in range(ny+1):objs.append(box('baluster',.22,.22,1.05,x+side*w/2,y-d/2+i*d/ny,z,mat))
        objs.append(box('stone handrail',.18,d,.16,x+side*w/2,y,z+.82,mat))
    return objs
def terrace(w,d,tiers=3,tier_h=2,inset=2,mat=None,**kwargs):
    objs=[]
    for t in range(tiers):
        ww=w-2*inset*t;dd=d-2*inset*t;zz=t*tier_h;objs.append(box('terrace',ww,dd,tier_h,z=zz,mat=mat));objs+=railing(ww-1,dd-1,zz+tier_h,mat)
        for side in [-1,1]:
            for k in range(8):objs.append(box('stair',6,(8-k)*.36,(k+1)*tier_h/8,0,side*(dd/2+(8-k)*.18),zz,mat))
    return objs,tiers*tier_h
def circular_terrace(r,tiers=3,tier_h=2,inset=3,mat=None,seg=96,radii=None,**kwargs):
    objs=[]
    for t in range(tiers):
        rr=radii[t] if radii else r-t*inset;zz=(t+1)*tier_h;objs.append(cyl('circular terrace',rr,tier_h,z=t*tier_h,seg=seg,mat=mat));n=math.ceil(math.tau*rr/3)
        for i in range(n):
            a=i*math.tau/n;objs.append(box('baluster',.2,.2,1,math.cos(a)*(rr-.4),math.sin(a)*(rr-.4),zz,mat))
        objs.append(tube('circular handrail',rr-.4,.13,z=zz+.8,seg=seg,mat=mat))
        for a in range(4):
            for k in range(8):
                stair=box('radial stair',5,(8-k)*.3,(k+1)*tier_h/8,0,-rr-(8-k)*.15,t*tier_h,mat);ang=a*math.pi/2;py=stair.location.y;stair.rotation_euler.z=ang;stair.location.x=-py*math.sin(ang);stair.location.y=py*math.cos(ang);objs.append(stair)
    return objs,tiers*tier_h
def hall_body(w,d,n_bays_x=9,n_bays_z=5,col_h=7,col_r=.4,mat_wall=None,mat_paint=None,name='hall'):
    objs=[]
    for i in range(n_bays_x+1):
        x=-w/2+i*w/n_bays_x
        for y in [-d/2,d/2]:objs.append(cyl('column',col_r,col_h,x,y,0,12,mat_wall))
    for i in range(1,n_bays_z):
        y=-d/2+i*d/n_bays_z
        for x in [-w/2,w/2]:objs.append(cyl('column',col_r,col_h,x,y,0,12,mat_wall))
    objs.append(box('recessed walls',w-2,d-2,col_h*.8,z=0,mat=mat_wall))
    for i in range(n_bays_x):
        x=-w/2+(i+.5)*w/n_bays_x
        for side in [-1,1]:
            objs.append(box('window recess',w/n_bays_x-.8,.06,col_h*.48,x,side*(d/2-.93),col_h*.18,M.get('dark',mat_wall)))
            for j in range(4):objs.append(box('window lattice',.08,.08,col_h*.48,x+(j-1.5)*w/n_bays_x/5,side*(d/2-.98),col_h*.18,mat_wall))
    for side in [-1,1]:
        objs.append(box('painted beam',w,.65,.65,0,side*d/2,col_h,mat_paint));objs.append(box('painted beam',.65,d,.65,side*w/2,0,col_h,mat_paint))
    n=max(8,int(2*(w+d)/1.8));per=2*(w+d)
    for i in range(n):
        s=i/n*per
        if s<w:x=-w/2+s;y=-d/2
        elif s<w+d:x=w/2;y=-d/2+s-w
        elif s<2*w+d:x=w/2-(s-w-d);y=d/2
        else:x=-w/2;y=d/2-(s-2*w-d)
        objs.append(box('dougong lower',.75,.75,.3,x,y,col_h+.65,mat_wall));objs.append(box('dougong arm',1.15,.38,.25,x,y,col_h+.95,mat_paint))
    return objs,col_h+1.2
def ridge_ornaments(w_ridge,z,mat,name='ridge',height=1.6):
    objs=[box('ridge beam',w_ridge,.5,.35,z=z,mat=mat)]
    for sign in [-1,1]:objs.append(cyl('ridge chiwen',.5,height,sign*(w_ridge/2-.3),0,z,12,mat,top_r=.22))
    return objs
def join_objs(objs,name='landmark'):
    bpy.ops.object.select_all(action='DESELECT');meshes=list(dict.fromkeys([o for root in objs for o in [root,*root.children_recursive] if o.type=='MESH']))
    for obj in meshes:
        obj.select_set(True);bpy.context.view_layer.objects.active=obj
        for mod in list(obj.modifiers):bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.context.view_layer.objects.active=meshes[0];bpy.ops.object.join();obj=bpy.context.object;obj.name=name;bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    bm=bmesh.new();bm.from_mesh(obj.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001);bmesh.ops.triangulate(bm,faces=list(bm.faces));bm.to_mesh(obj.data);bm.free();obj.data.update();return obj
def export_glb(path,obj):
    bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',export_yup=True,use_selection=True,export_animations=False,export_cameras=False,export_lights=False,export_extras=True)
