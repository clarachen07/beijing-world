"""Reproducible landmark assets. blender -b -P blender/build_all.py -- --only taihedian,qiniandian,cctv
Reference-calibrated envelopes; unmeasured facade details are architectural approximations.
"""
import bpy,sys,math,json,argparse
from pathlib import Path
from mathutils import Vector
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'blender'))
import cnroof as c
from materials import bake_materials
OUT=ROOT/'public/models/landmarks';SOURCE=ROOT/'assets-source/blend';OUT.mkdir(parents=True,exist_ok=True);SOURCE.mkdir(parents=True,exist_ok=True)
REGISTRY=json.loads((ROOT/'config/landmarks.json').read_text())['landmarks']
DEFS={d['model']:d for d in REGISTRY if d.get('model')}

def reset():
    for o in list(bpy.data.objects):bpy.data.objects.remove(o,do_unlink=True)
    bpy.context.scene.unit_settings.system='METRIC';bpy.context.scene.unit_settings.scale_length=1

def roof(w,d,h,z,x=0,y=0,material='gold',top_w=None,top_d=0,gable=False):
    o=c.hip_roof(w,d,h,top_w=top_w,top_d=top_d,mat=c.M[material],gable=gable);o.location=(x,y,z);return o

def hall(w,d,z,col=7,x=0,y=0,bays=5,roofmat='gold',total=None,pavilion=False):
    objs,h=c.hall_body(w,d,n_bays_x=bays,n_bays_z=3,col_h=col,mat_wall=c.M['redwood'],mat_paint=c.M['caihua'])
    for o in objs:o.location.x+=x;o.location.y+=y;o.location.z+=z
    objs.append(roof(w+3,d+3,4 if total is None else max(2,total-col-1.2),z+h,x,y,roofmat,top_w=0 if pavilion else w*.55))
    if not pavilion:objs+=move(c.ridge_ornaments(w*.55,z+h+4-.4,c.M[roofmat]),x,y)
    return objs

def move(objs,x=0,y=0,z=0):
    for o in objs:o.location.x+=x;o.location.y+=y;o.location.z+=z
    return objs

def arch_podium(w,d,h,openings=1,material='red',width=6,spring=4,centers=None,widths=None,springs=None):
    # Empty arched tunnels, not black rectangles painted onto a solid box.
    objs=[];centers=centers if centers is not None else [(i-(openings-1)/2)*width*2.5 for i in range(openings)];left=-w/2;mat=c.M.get(material,c.M.get('red'))
    for index,center in enumerate(centers):
        aw=widths[index] if widths else width;sp=springs[index] if springs else spring
        lo,hi=center-aw/2,center+aw/2
        if lo>left:objs.append(c.box('gate pier',lo-left,d,h,(left+lo)/2,0,0,mat))
        for k in range(16):
            x0=lo+k*aw/16;x1=lo+(k+1)*aw/16
            z0=sp+math.sqrt(max(0,(aw/2)**2-(x0-center)**2));z1=sp+math.sqrt(max(0,(aw/2)**2-(x1-center)**2))
            verts=[(x0,-d/2,z0),(x1,-d/2,z1),(x1,d/2,z1),(x0,d/2,z0),(x0,-d/2,h),(x1,-d/2,h),(x1,d/2,h),(x0,d/2,h)]
            objs.append(c.new_mesh_obj('arch vault',verts,[(0,3,2,1),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7),(4,5,6,7)],mat))
        left=hi
    if left<w/2:objs.append(c.box('gate pier',w/2-left,d,h,(left+w/2)/2,0,0,mat))
    return objs

def gate_model(w,d,ph,hw,hd,hh=7,eaves=2,roofmat='gold',openings=1,gray=False,bays=None,gable=True,target=None,eave_spacing=4):
    objs=arch_podium(w,d,ph,openings,'gray' if gray else 'red',width=6,spring=min(5,ph*.38));objs+=c.railing(w-.8,d-.8,ph,c.M['marble'])
    body,_=c.hall_body(hw,hd,n_bays_x=bays or (9 if hw>50 else 7),n_bays_z=3,col_h=hh,mat_wall=c.M['redwood'],mat_paint=c.M['caihua'])
    objs+=move(body,z=ph+.3)
    bottom=ph+hh+1.5
    upper_bottom=bottom+(eaves-1)*eave_spacing
    upper_height=target-1.6-upper_bottom if target else 6.5
    lower_height=3.1 if eave_spacing==4 else min(3.1,eave_spacing*.72)
    storey_height=3 if eave_spacing==4 else min(1.8,eave_spacing*.6)
    for k in range(eaves):
        ww=hw+5-k*1.3;dd=hd+5-k*1.3
        objs.append(roof(ww,dd,lower_height if k<eaves-1 else upper_height,bottom+k*eave_spacing,material=roofmat,top_w=ww*.58,top_d=dd*.58 if k<eaves-1 else 0,gable=gable and k==eaves-1))
        if k<eaves-1:objs.append(c.box('upper storey',hw-2,hd-2,storey_height,0,0,bottom+k*eave_spacing+1.8,c.M['redwood']))
    objs+=c.ridge_ornaments((hw+5)*.58,upper_bottom+upper_height,c.M[roofmat]);return objs

def taihedian():
    objs,tz=c.terrace(83,55,tiers=3,tier_h=2.71,inset=2,mat=c.M['marble'])
    body,h=c.hall_body(63.96,37.17,n_bays_x=11,n_bays_z=5,col_h=8.47,col_r=.53,mat_wall=c.M['redwood'],mat_paint=c.M['caihua']);objs+=move(body,z=tz)
    objs.append(roof(69.8,43,4,tz+h,top_w=49,top_d=25))
    upper,uh=c.hall_body(48,24,n_bays_x=9,n_bays_z=3,col_h=4.5,col_r=.42,mat_wall=c.M['redwood'],mat_paint=c.M['caihua']);objs+=move(upper,z=19.8)
    objs.append(roof(54,29,9.55,25.5,top_w=30))
    objs+=c.ridge_ornaments(30,34.04,c.M['gold'],height=3.4)
    # Ten ridge figures, in sequence on each sloping corner ridge.
    for side in [-1,1]:
        for k in range(10):
            t=(k+1)/13;objs.append(c.cyl('ridge beast',.15+.025*k,.36,side*(27-12*t),-14.5*(1-t),25.5+9.55*t**1.45+.2,8,c.M['gold']))
    return objs

def qiniandian():
    # Beijing Municipal Parks' detailed part dimensions: 90.3/79.3/68.2m altar,
    # 5.2m altar + 31.6m hall = 36.8m. Other official summaries say "about 38m".
    objs,tz=c.circular_terrace(45.15,tiers=3,tier_h=5.2/3,radii=[45.15,39.65,34.1],mat=c.M['marble'])
    body_scale=31.6/32
    body_z=lambda z:tz+(z-6)*body_scale
    objs.append(c.cyl('hall drum',12,9.2*body_scale,z=tz,seg=96,mat=c.M['redwood']))
    # 4 central dragon-well, 12 inner and 12 outer pillars: 28 in their documented rings.
    for count,r,H,col_r in [(4,4,19.2,.6),(12,8,18*body_scale,.4),(12,12,9.2*body_scale,.4)]:
        for i in range(count):
            a=i*math.tau/count;objs.append(c.cyl('28 timber columns',col_r,H,r*math.cos(a),r*math.sin(a),tz,12,c.M['redwood']))
    for i in range(12):
        a=(i+.5)*math.tau/12
        panel=c.box('prayer hall lattice window',2,.12,3.2*body_scale,11.98*math.cos(a),11.98*math.sin(a),tz+2*body_scale,c.M['glass']);panel.rotation_euler.z=a-math.pi/2;objs.append(panel)
    objs.append(c.cyl('painted lower beam ring',12.1,.7*body_scale,z=tz+8.4*body_scale,seg=96,mat=c.M['caihua']))
    for r,z,h in [(16,15.2,4),(13.2,19.6,5.3),(10.8,25.3,9.6)]:
        objs.append(c.cyl('painted eave ring',r-.8,1.1*body_scale,z=body_z(z-.9),seg=96,mat=c.M['caihua']))
        o=c.conic_roof(r,.6 if z>25 else r*.55,h*body_scale,mat=c.M['blue']);o.location.z=body_z(z);objs.append(o)
    objs.append(c.cyl('gold finial',.7,2.4*body_scale,z=body_z(34.9),seg=24,mat=c.M['goldbright'],top_r=.23));objs.append(c.cyl('finial flame',.27,.7*body_scale,z=body_z(37.3),seg=16,mat=c.M['goldbright'],top_r=0));return objs

def wumen_podium():
    # North has five arches; the lateral two turn into the U-wing courtyard.
    # Mouth count is photographed; exact tunnel routing/sections are inferred.
    objs=arch_podium(126,30,12,5,width=7,spring=5,centers=[-52,-17.5,0,17.5,52])
    for side in [-1,1]:
        x=side*52
        objs.append(c.box('U wing closed south podium',18,41,12,x,-49,0,c.M['red']))
        objs+=move(arch_podium(18,17,12,1,width=7,spring=5),x,-13)
        turn=arch_podium(7,12.5,12,1,width=7,spring=5)
        for o in turn:
            xx,yy=o.location.x,o.location.y;o.location.x=side*(49.25-yy);o.location.y=-25+xx;o.rotation_euler.z=side*math.pi/2
        objs+=turn
        objs.append(c.box('U wing outer curve pier',5.5,7,12,side*58.25,-25,0,c.M['red']))
    return objs

def wumen():
    objs=wumen_podium();objs+=c.railing(124,28,12,c.M['marble'])
    body,_=c.hall_body(60.05,25,n_bays_x=9,n_bays_z=5,col_h=10,mat_wall=c.M['redwood'],mat_paint=c.M['caihua']);objs+=move(body,z=12)
    objs.append(roof(66,31,4.5,23.2,top_w=48,top_d=20));objs.append(c.box('main upper storey',46,19,3,z=26,mat=c.M['redwood']))
    objs.append(roof(58,27,6.6,29,top_w=30));objs+=c.ridge_ornaments(30,34.6,c.M['gold'],height=1)
    for x in [-52,52]:
        corridor=hall(60,12,12,col=4,bays=13)
        for o in corridor:
            xx,yy=o.location.x,o.location.y;o.location.x=x-yy;o.location.y=-37+xx;o.rotation_euler.z+=math.pi/2
        objs+=corridor
        for y in [-12,-66]:
            objs+=hall(13,13,12,col=7,x=x,y=y,bays=3,pavilion=True);objs.append(roof(17,17,5,24,x,y,top_w=0))
    return objs

def zhonglou_masonry():
    objs=arch_podium(32,32,24,1,'gray',width=6,spring=5)
    objs+=move(arch_podium(29,22,10.2,3,'gray',centers=[-9.2,0,9.2],widths=[3,6.2,3],springs=[3.5,5,3.5]),z=24.8)
    # Side arch windows are recessed closed shutters, rather than tunnels.
    for side in [-1,1]:
        for y in [-10.2,10.2]:objs.append(c.box('recessed bell room shutter',2.9,.18,5,side*9.2,y,24.8,c.M.get('dark',c.M['red'])))
    return objs

def zhonglou():
    objs=zhonglou_masonry();objs+=c.railing(31,31,24,c.M['marble'])
    objs.append(roof(34,27,3,35.5,material='dark',top_w=26,top_d=17))
    objs.append(c.box('grey brick upper roof storey',23,16,2.2,z=37.5,mat=c.M['gray']))
    upper=roof(31,24,7.3,39,material='dark',top_w=18,gable=True)
    for child in upper.children:child.data.materials.clear();child.data.materials.append(c.M['gray'])
    objs.append(upper)
    for w,d,z in [(34,27,35.55),(31,24,39.05)]:
        for sign in [-1,1]:
            objs.append(c.box('green glazed roof edge',w,.3,.25,0,sign*d/2,z,c.M['green']))
            objs.append(c.box('green glazed roof edge',.3,d,.25,sign*w/2,0,z,c.M['green']))
    objs+=c.ridge_ornaments(18,46.3,c.M['dark'])
    for k in range(4):objs.append(c.box('bell room approach stair',5,3-k*.6,(k+1)*.2,0,-12-k*.2,24,c.M['marble']))
    return objs

def jiaolou():
    objs=[c.box('corner platform',25,25,10,mat=c.M['gray'])]
    objs+=hall(14,14,10,col=5.5,bays=3)
    # Three eave layers and unequal cross wings, as documented in the Palace roof plan.
    for z,w,d,h in [(16.7,28,24,2.8),(19.4,23,13,3),(22.4,16,8,4.5)]:
        objs.append(roof(w,d,h,z,top_w=w*.5,top_d=0))
        cross=roof(d,w,h,z,top_w=d*.5);cross.rotation_euler.z=math.pi/2;objs.append(cross)
    objs.append(c.cyl('gilt corner finial',.25,.6,z=26.9,mat=c.M['goldbright'],top_r=0));return objs

def tower_profile(profile,height,depth_ratio=1,material='glass',name='tower'):
    verts=[];faces=[]
    for t,w in profile:
        verts.extend([(-w/2,-w*depth_ratio/2,t*height),(w/2,-w*depth_ratio/2,t*height),(w/2,w*depth_ratio/2,t*height),(-w/2,w*depth_ratio/2,t*height)])
    for k in range(len(profile)-1):
        for i in range(4):faces.append((k*4+i,k*4+(i+1)%4,(k+1)*4+(i+1)%4,(k+1)*4+i))
    faces+=[(3,2,1,0),tuple((len(profile)-1)*4+i for i in range(4))];return c.new_mesh_obj(name,verts,faces,c.M[material])

def chinazun():
    profile=[(0,78),(.12,62),(.3,54),(.52,55),(.72,63),(.94,69),(1,68)]
    o=tower_profile(profile,528,name='China Zun hourglass');objs=[o]
    # Narrow vertical fins describe the taper without extending above the real 528m crown.
    for side in [-1,1]:
        for i in range(11):
            for k in range(len(profile)-1):
                t0,w0=profile[k];t1,w1=profile[k+1];u=(i-5)/12
                objs.append(c.beam('facade fin',(u*w0,side*w0/2,t0*528),(u*w1,side*w1/2,t1*528),.27,c.M['steel']))
    return objs

def cctv():
    objs=[]
    def diagrid_quad(name,corners,columns,levels):
        # Photos show the mesh continuing around tower corners and across the
        # cantilever underside. These are representative, not fabricated rods.
        def point(u,v):
            a,b,d,e=[Vector(p) for p in corners]
            return a.lerp(b,u).lerp(e.lerp(d,u),v)
        for row,(v0,v1) in enumerate(zip(levels,levels[1:])):
            width=.48 if row<3 or row>=len(levels)-4 else .32
            for column in range(columns):
                u0,u1=column/columns,(column+1)/columns
                objs.append(c.beam(name,point(u0,v0),point(u1,v1),width,c.M['steel']))
                objs.append(c.beam(name,point(u1,v0),point(u0,v1),width,c.M['steel']))
    def sloped(name,base,top,w,d,z0,z1):
        verts=[]
        for (x,y),z in [(base,z0),(top,z1)]:verts.extend([(x-w/2,y-d/2,z),(x+w/2,y-d/2,z),(x+w/2,y+d/2,z),(x-w/2,y+d/2,z)])
        objs.append(c.new_mesh_obj(name,verts,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],c.M['glass']))
        levels=[0,.045,.09,.15,.23,.32,.41,.5,.59,.68,.77,.85,.9,.94,.97,1]
        for side in range(4):
            j=(side+1)%4
            diagrid_quad('continuous tower diagrid',[verts[side],verts[j],verts[4+j],verts[4+side]],4,levels)
    sloped('inclined north tower',(-42,36),(-13,15),45,48,0,234)
    sloped('inclined south tower',(43,-43),(20,-14),44,47,0,210)
    # Upper L shaped cantilever closes a three-dimensional continuous loop.
    for name,w,d,x,y in [('north',76,48,25,15),('return',44,76,41,-16)]:
        objs.append(c.box('upper cantilever '+name,w,d,43,x,y,191,c.M['glass']))
        low=[(x-w/2,y-d/2,191),(x+w/2,y-d/2,191),(x+w/2,y+d/2,191),(x-w/2,y+d/2,191)]
        high=[(xx,yy,234) for xx,yy,_ in low]
        for side in range(4):
            j=(side+1)%4
            diagrid_quad('cantilever exterior diagrid',[low[side],low[j],high[j],high[side]],max(3,round((w if side%2==0 else d)/10)),[0,.16,.33,.5,.67,.84,1])
        underside=[(xx,yy,zz-.04) for xx,yy,zz in low]
        diagrid_quad('cantilever underside diagrid',underside,max(3,round(w/10)),[i/5 for i in range(6)])
    objs.append(c.box('base wing north',120,40,24,0,39,0,c.M['glass']))
    objs.append(c.box('base wing east',44,94,24,43,-8,0,c.M['glass']))
    return objs

def birdnest():
    from birdnest import build
    return build()

def watercube():
    # Open photographs resolve a recessed glazed ground storey and pale columns.
    # Its 4.2m height / 1.8m recess and repetition on unshown sides are inferred.
    entrance_h=4.2
    shell=c.box('irregular ETFE pillow facade',177,177,31-entrance_h,z=entrance_h,mat=c.M['bubble'])
    for uv in shell.data.uv_layers.active.data:uv.uv*=.125
    objs=[shell,c.box('recessed entrance glazing',173.4,173.4,entrance_h,mat=c.M['glass'])]
    for side in [-1,1]:
        for i in range(15):
            t=-84+i*12
            objs.append(c.box('entrance white column',.6,.6,entrance_h,t,side*88.1,0,c.M['white']))
            objs.append(c.box('entrance white column',.6,.6,entrance_h,side*88.1,t,0,c.M['white']))
        for i in range(29):
            t=-84+i*6
            objs.append(c.box('entrance glazing column mullion',.1,.16,entrance_h,t,side*86.8,0,c.M['steel']))
            objs.append(c.box('entrance glazing column mullion',.16,.1,entrance_h,side*86.8,t,0,c.M['steel']))
        objs.append(c.box('entrance header',177,.65,.3,0,side*88.1,entrance_h-.3,c.M['white']))
        objs.append(c.box('entrance header',.65,177,.3,side*88.1,0,entrance_h-.3,c.M['white']))
    return objs

def ncpa():
    verts=[];faces=[];seg=96;rows=24
    for j in range(rows+1):
        angle=j/rows*math.pi/2;r=math.cos(angle);z=46.68*math.sin(angle)
        verts.extend([(106.1*r*math.cos(i*math.tau/seg),71.82*r*math.sin(i*math.tau/seg),z) for i in range(seg)])
    for j in range(rows):
        for i in range(seg):faces.append((j*seg+i,j*seg+(i+1)%seg,(j+1)*seg+(i+1)%seg,(j+1)*seg+i))
    o=c.new_mesh_obj('half ellipsoid shell',verts,faces,c.M['titan']);o.data.materials.append(c.M['glass'])
    for p in o.data.polygons:
        ctr=p.center
        if abs(ctr.x)<14:p.material_index=1
        p.use_smooth=True
    return [o]

def white_dagoba():
    objs=[c.box('dagoba plinth',19,19,3,mat=c.M['gray'])]
    profile=[(3,8),(4,8),(5,6),(7,5),(9,6.5),(12,7.7),(17,7),(21,4.5),(22.5,3),(24,2.5),(26,2),(30,1.4),(31,2.8),(32,1.7),(33,2.5),(34,.5),(35.9,0)]
    for i in range(len(profile)-1):
        z0,r0=profile[i];z1,r1=profile[i+1];objs.append(c.cyl('stupa profile',r0,z1-z0,z=z0,seg=64,mat=c.M['goldbright' if z0>=31 else 'white'],top_r=r1))
    objs.append(c.box('Tibetan niche',3,.12,4,0,-6.9,13,c.M['dark']))
    for k in range(14):
        a=k*math.tau/14;objs.append(c.cyl('copper bell',.16,.35,2.65*math.cos(a),2.65*math.sin(a),30.6,8,c.M['goldbright']))
    return objs

def white_dagoba_coarse():
    profile=[(3,8),(5,6),(9,6.5),(12,7.7),(17,7),(21,4.5),(24,2.5),(30,1.4),(31,2.8),(32,1.7),(33,2.5),(34,.5),(35.9,0)]
    seg=16;verts=[(r*math.cos(i*math.tau/seg),r*math.sin(i*math.tau/seg),z) for z,r in profile for i in range(seg)]
    faces=[(j*seg+i,j*seg+(i+1)%seg,(j+1)*seg+(i+1)%seg,(j+1)*seg+i) for j in range(len(profile)-1) for i in range(seg)]
    faces.append(tuple(reversed(range(seg))))
    return [c.box('coarse dagoba plinth',19,19,3,mat=c.M['gray']),c.new_mesh_obj('coarse stupa silhouette',verts,faces,c.M['white'])]

def monument():
    objs=[]
    for w,d,z,h in [(50.44,61.54,0,1.6),(42,52,1.6,1.2),(20,22,2.8,2),(13,14,4.8,3.2)]:objs.append(c.box('marble monument platform',w,d,h,z=z,mat=c.M['marble']))
    objs.append(c.box('stele',9.2,4.3,27.8,z=8,mat=c.M['cream']));objs.append(roof(10,5,2.14,35.8,material='cream',top_w=8.2,top_d=3.8));return objs

def olympic_tower():
    objs=[];centres=[]
    for i,H in enumerate([246.8,231,216,201,186]):
        a=i*math.tau/5;x=13*math.cos(a);y=13*math.sin(a)
        centres.append((x,y))
        objs.append(c.cyl('tower shaft',5.3,H-16,x,y,0,20,c.M['white'],top_r=3.8))
        objs.append(c.cyl('observation pod',11,10,x,y,H-16,32,c.M['glass'],top_r=10))
        objs.append(c.cyl('pod roof',11,6,x,y,H-6,32,c.M['steel'],top_r=5))
        # The viewed completed photos show an expanding tree-like support below
        # every round crown. These are representative branches, not surveyed rods.
        for j in range(8):
            angle=j*math.tau/8
            root=(x+3.6*math.cos(angle),y+3.6*math.sin(angle),H-31)
            fork=(x+6*math.cos(angle),y+6*math.sin(angle),H-24)
            objs.append(c.beam('crown branching trunk',root,fork,.70,c.M['towerwhite']))
            for delta in [-math.tau/32,0,math.tau/32]:
                rim=(x+10.4*math.cos(angle+delta),y+10.4*math.sin(angle+delta),H-16)
                objs.append(c.beam('crown fork support',fork,rim,.50 if delta==0 else .32,c.M['towerwhite']))
    # Low-angle photos show substantial links between the shafts. Heights,
    # section sizes and exact routing remain explicitly inferred.
    for i,a in enumerate(centres):
        b=centres[(i+1)%5];delta=Vector((b[0]-a[0],b[1]-a[1],0)).normalized()
        for z in [48,100,151]:
            # Penetrate the tapered shaft envelope even at the highest link,
            # so inferred connectors are continuous instead of floating ends.
            left=(a[0]+3.5*delta.x,a[1]+3.5*delta.y,z)
            right=(b[0]-3.5*delta.x,b[1]-3.5*delta.y,z)
            objs.append(c.beam('inter tower horizontal link',left,right,1.35,c.M['towerwhite']))
            objs.append(c.beam('inter tower diagonal link',(left[0],left[1],z-7),right,.75,c.M['towerwhite']))
    return objs

def linglong():
    objs=[c.box('broadcast base',30,30,6,mat=c.M['steel'])]
    for i in range(6):
        z=6+i*19.5;size=24-i*1.4;o=c.box('broadcast pod',size,size,8,z=z+10,mat=c.M['glass']);o.rotation_euler.z=(i%2)*math.pi/4;objs.append(o)
        objs.append(c.cyl('central support',3,19.5,z=z,seg=12,mat=c.M['steel']))
    # The completed close photograph supports a white open exterior frame and
    # large diagonal braces; their sections and grid dimensions are inferred.
    corners=[(-14,-14),(14,-14),(14,14),(-14,14)]
    for x,y in corners:objs.append(c.beam('white exterior tower column',(x,y,0),(x,y,123),.65,c.M['towerwhite']))
    for i in range(7):
        z=6+i*19.5
        for j,a in enumerate(corners):
            b=corners[(j+1)%4]
            objs.append(c.beam('white exterior frame beam',(a[0],a[1],z),(b[0],b[1],z),.55,c.M['towerwhite']))
            if i<6:
                objs.append(c.beam('white exterior diagonal brace',(a[0],a[1],z),(b[0],b[1],z+19.5),.38,c.M['towerwhite']))
                objs.append(c.beam('white exterior diagonal brace',(b[0],b[1],z),(a[0],a[1],z+19.5),.38,c.M['towerwhite']))
    objs.append(c.cyl('antenna',.45,9,z=123,mat=c.M['steel']));return objs

def biyong(w,d):
    # Actual Guozijian building 1 pixels show two golden pyramidal eaves and a
    # spherical finial. Part heights/upper-room dimensions are inferred.
    body,h=c.hall_body(w,d,n_bays_x=5,n_bays_z=5,col_h=6,mat_wall=c.M['redwood'],mat_paint=c.M['caihua'])
    objs=move(body,z=.45)
    objs.append(c.box('lower biyong painted frieze',w,d,.5,z=7.65,mat=c.M['caihua']))
    objs.append(roof(w+3,d+3,2.2,8.15,top_w=w*.62,top_d=d*.62))
    upper,_=c.hall_body(w*.62,d*.62,n_bays_x=5,n_bays_z=5,col_h=2.5,mat_wall=c.M['redwood'],mat_paint=c.M['caihua'])
    objs+=move(upper,z=9.8)
    objs.append(c.box('upper biyong painted frieze',w*.62,d*.62,.5,z=13.5,mat=c.M['caihua']))
    objs.append(roof(w*.73+3,d*.73+3,3.2,14,top_w=0,top_d=0))
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=8,radius=.4,location=(0,0,17.6));ball=bpy.context.object;ball.name='biyong gold spherical finial';ball.data.materials.append(c.M['goldbright']);objs.append(ball)
    return objs

def yuetan_clock(w,d):
    # Both completed reference angles show two green eaves, red masonry and an
    # open arched ground passage, not a generic column hall.
    objs=arch_podium(w,d,3.8,material='red',width=3,spring=1.8)
    objs.append(roof(w+2,d+2,1.2,3.8,material='green',top_w=w*.72,top_d=d*.72))
    upper=arch_podium(w-2,d-2,3.2,material='red',width=2.4,spring=1.8)
    objs+=move(upper,z=4.65)
    for side in [-1,1]:objs.append(c.box('closed upper clock arch shutter',2.4,.10,2.8,0,side*(d/2-1.15),4.65,c.M['redwood']))
    objs.append(roof(w+1,d+1,2.8,7.8,material='green',top_w=w*.58,gable=True))
    objs+=c.ridge_ornaments(w*.58,10.4,c.M['green'],height=.6)
    return objs

def complex_layout(definition):
    objs=[]
    for b in definition.get('layout',[]):
        w,d=max(3,b['w']-1.5),max(3,b['d']-1.5);H=b['heightM'];x,y=b['x'],b['y']
        if max(w,d)>min(w,d)*1.7 and d>w:w,d=d,w;rotate=True
        else:rotate=False
        if definition['id']=='confucius-guozijian' and b['name']=='辟雍':parts=biyong(w,d)
        elif definition['id']=='yuetan' and b['name']=='钟楼':parts=yuetan_clock(w,d)
        else:parts=hall(w,d,.45,col=max(3,H-5.2),bays=max(3,round(w/5)),roofmat='gold' if definition['id']=='yonghegong' or '大成殿' in b['name'] or '辟雍' in b['name'] else 'dark',pavilion=b.get('roof')=='pavilion')
        # A full foundation slab would close the verified ground passage.
        if not (definition['id']=='yuetan' and b['name']=='钟楼'):
            parts.append(c.box('individual stone platform',w+2,d+2,.45,mat=c.M['marble']))
        if '万福阁' in b['name']:
            parts.append(roof(w+3,d+3,4,H*.55,top_w=w*.6,top_d=d*.6));parts.append(roof(w+2,d+2,4,H*.78,top_w=w*.5))
        for o in parts:
            if rotate:
                xx,yy=o.location.x,o.location.y;o.location.x=-yy;o.location.y=xx;o.rotation_euler.z+=math.pi/2
            o.location.x+=x;o.location.y+=y
        objs+=parts
    for altar in definition.get('altars',[]):
        for i in range(altar.get('tiers',1)):
            objs.append(c.box('ritual altar',altar.get('sizes',[altar['w']-j*2 for j in range(altar.get('tiers',1))])[i],altar.get('sizes',[altar['d']-j*2 for j in range(altar.get('tiers',1))])[i],altar.get('heightM',2)/altar.get('tiers',1),altar['x'],altar['y'],i*altar.get('heightM',2)/altar.get('tiers',1),c.M['gray']))
    for wall in definition.get('enclosures',[]):
        if wall.get('polygonLocal'):
            p=wall['polygonLocal'];h=wall.get('heightM',2.5)
            for a,b in zip(p,p[1:]):
                dx,dy=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dy);n=max(1,math.ceil(length/4))
                for i in range(n):
                    x,y=a[0]+dx*(i+.5)/n,a[1]+dy*(i+.5)/n
                    if min(abs(x),abs(y))<3:continue
                    obj=c.box('mapped ritual enclosure',length/n,.7,h,x,y,0,c.M['red']);obj.rotation_euler.z=math.atan2(dy,dx);objs.append(obj)
            continue
        w,d=wall['w'],wall['d'];x,y=wall.get('x',0),wall.get('y',0);h=wall.get('heightM',2.5)
        for side in [-1,1]:
            for sign in [-1,1]:
                objs.append(c.box('ritual enclosure',w/2-3,.7,h,x+sign*(w/4+1.5),y+side*d/2,0,c.M['red']))
                objs.append(c.box('ritual enclosure',.7,d/2-3,h,x+side*w/2,y+sign*(d/4+1.5),0,c.M['red']))
    return objs

BUILDERS={
 'taihedian':taihedian,'qiniandian':qiniandian,'wumen':wumen,'jiaolou':jiaolou,
 'tiananmen':lambda:gate_model(110,37,13,57.14,20.97,8.2,2,openings=5,target=DEFS['tiananmen']['heightM']),
 'zhengyangmen':lambda:gate_model(95,31.45,14.7,36.7,16.5,7,3,roofmat='dark',gray=True,target=DEFS['zhengyangmen']['heightM']),
 'jianlou':lambda:gate_model(52,28,12.6,36,21,7,2,roofmat='dark',gray=True,target=DEFS['jianlou']['heightM']),
 'yongdingmen':lambda:gate_model(26,18,8,24,13,5,3,roofmat='dark',gray=True,target=DEFS['yongdingmen']['heightM'],eave_spacing=3),
 'shenwumen':lambda:gate_model(60,25,10,48,18,7,2,openings=3,target=DEFS['shenwumen']['heightM']),
 'donghuamen':lambda:gate_model(44,24,9,36,15,5,2,openings=3,bays=5,gable=False,target=DEFS['donghuamen']['heightM']),
 'xihuamen':lambda:gate_model(44,24,9,36,15,5,2,openings=3,bays=5,gable=False,target=DEFS['xihuamen']['heightM']),
 'taihemen':lambda:gate_model(55,25,3,44,18,8,2,openings=3,target=DEFS['taihemen']['heightM']),
 'gulou':lambda:gate_model(56,33,24,43,24,7,3,roofmat='dark',gray=False,target=DEFS['gulou']['heightM'],eave_spacing=3),
 'zhonglou':zhonglou,
 'chinazun':chinazun,'cctv':cctv,'birdnest':birdnest,'ncpa':ncpa,
 'watercube':watercube,
 'guomao3':lambda:[tower_profile([(0,47),(.7,47),(.9,43),(1,36)],330,1.05,name='China World Tower')],
 'white-dagoba':white_dagoba,'monument':monument,'olympic-tower':olympic_tower,'linglong':linglong,
}

def save(name,objs):
    bpy.context.view_layer.update()
    far_objects=[];depsgraph=bpy.context.evaluated_depsgraph_get()
    detail_words=('baluster','handrail','dougong','window lattice','ridge beast','diagrid','facade fin','woven lattice','rim steel','28 timber columns','column')
    for obj in list(dict.fromkeys([o for root in objs for o in [root,*root.children_recursive] if o.type=='MESH'])):
        if any(word in obj.name for word in detail_words):continue
        clone=bpy.data.objects.new('coarse '+obj.name,bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph)))
        bpy.context.collection.objects.link(clone);clone.matrix_world=obj.matrix_world.copy();far_objects.append(clone)
    if name=='white-dagoba':
        for obj in far_objects:bpy.data.objects.remove(obj,do_unlink=True)
        far_objects=white_dagoba_coarse()
    main=c.join_objs(objs,name);target=DEFS[name]['heightM']
    zmin=min(v.co.z for v in main.data.vertices);zmax=max(v.co.z for v in main.data.vertices)
    # Calibrate architectural envelope to its explicit measurement; transformations are baked.
    if name=='qiniandian' and (abs(zmin)>.005 or abs(zmax-target)>.005):
        raise ValueError('Prayer hall part dimensions must already yield the physical 36.8m envelope')
    for v in main.data.vertices:v.co.z=v.co.z if name=='qiniandian' else (v.co.z-zmin)*target/(zmax-zmin)
    main.data.update();main['assetId']=name;main['unit']='metre';main['accuracy']=DEFS[name]['accuracy'];main['heightM']=target
    coarse=c.join_objs(far_objects,name+' coarse')
    for v in coarse.data.vertices:v.co.z=v.co.z if name=='qiniandian' else (v.co.z-zmin)*target/(zmax-zmin)
    coarse.data.update();coarse.hide_render=True;coarse.hide_viewport=True
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/f'{name}.blend'),compress=True)
    c.export_glb(OUT/f'{name}.glb',main)
    stats={'near':len(main.data.polygons),'heightM':target,'boundsXYZ':[[min(v.co[i] for v in main.data.vertices) for i in range(3)],[max(v.co[i] for v in main.data.vertices) for i in range(3)]]}
    for suffix,ratio in [('medium',.62),('far',.18)]:
        source=main if suffix=='medium' else coarse
        copy=source.copy();copy.data=source.data.copy();copy.hide_render=False;copy.hide_viewport=False;bpy.context.collection.objects.link(copy);bpy.context.view_layer.objects.active=copy;copy.select_set(True)
        if len(source.data.polygons)<64:ratio=1
        elif suffix=='far' and len(source.data.polygons)<1500:ratio=.4 if len(main.data.polygons)<1000 else .75
        if name=='linglong' and suffix=='far':ratio=.35
        mod=copy.modifiers.new('distance simplification','DECIMATE');mod.ratio=ratio;mod.use_collapse_triangulate=True;bpy.ops.object.modifier_apply(modifier=mod.name);copy['lod']=suffix
        if suffix=='far':
            for i,original in enumerate(list(copy.data.materials)):
                flat=bpy.data.materials.new(original.name+' far');flat.use_nodes=True;flat.diffuse_color=original.diffuse_color
                bs=flat.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=original.diffuse_color;bs.inputs['Roughness'].default_value=.7
                copy.data.materials[i]=flat
        c.export_glb(OUT/f'{name}-{suffix}.glb',copy);stats[suffix]=len(copy.data.polygons);bpy.data.objects.remove(copy,do_unlink=True)
    # Proxy has real open tunnels for gates; otherwise a simplified static mesh.
    copy=coarse.copy();copy.data=coarse.data.copy();copy.hide_render=False;copy.hide_viewport=False;bpy.context.collection.objects.link(copy);copy.data.materials.clear();copy.name=name+' collision';copy['collision']=True
    for p in copy.data.polygons:p.material_index=0
    bpy.context.view_layer.objects.active=copy;copy.select_set(True);mod=copy.modifiers.new('collision simplification','DECIMATE');mod.ratio=1 if len(coarse.data.polygons)<64 else .75 if len(coarse.data.polygons)<1500 else .08;mod.use_collapse_triangulate=True;bpy.ops.object.modifier_apply(modifier=mod.name)
    c.export_glb(OUT/f'{name}-collision.glb',copy);stats['collision']=len(copy.data.polygons);bpy.data.objects.remove(copy,do_unlink=True)
    bpy.data.objects.remove(coarse,do_unlink=True)
    (SOURCE/f'{name}.json').write_text(json.dumps(stats,indent=2)+'\n');print('BUILT',name,stats,flush=True);reset()

def main():
    args=argparse.ArgumentParser();args.add_argument('--only');args.add_argument('--force-textures',action='store_true');args.add_argument('--force-materials',default='');options=args.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    reset();bake_materials(force=options.force_textures,force_keys=options.force_materials.split(','))
    names=options.only.split(',') if options.only else list(DEFS)
    for name in names:
        if name not in DEFS:raise ValueError('Unknown asset '+name)
        save(name,BUILDERS[name]() if name in BUILDERS else complex_layout(DEFS[name]))
    print('LANDMARK BUILD COMPLETE',flush=True)
if __name__=='__main__':main()
