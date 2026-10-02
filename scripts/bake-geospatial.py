"""Bake real source geometry into bounded 500m/2km/8km scene tiles."""
from __future__ import annotations
import gzip, hashlib, io, json, math, re, struct, time
from collections import Counter
from pathlib import Path
import numpy as np
import mapbox_earcut
from PIL import Image
from scipy.ndimage import gaussian_filter, percentile_filter
from shapely import make_valid, normalize, STRtree
from shapely.affinity import affine_transform
from shapely.geometry import Polygon, LineString, Point, box, shape
from shapely.ops import unary_union

ROOT=Path(__file__).resolve().parents[1]; RAW=ROOT/'raw/geospatial'; OUT=ROOT/'public/data'
CFG=json.loads((ROOT/'config/world.json').read_text()); ORIGIN=CFG['origin']
MLAT=CFG['projection']['metresPerDegreeLat']; MLON=111320*math.cos(math.radians(ORIGIN['lat']))
AFFINE=[MLON,0,0,-MLAT,-ORIGIN['lon']*MLON,ORIGIN['lat']*MLAT]
RESOURCES={}; STATS=Counter(); HEIGHT_CONFIDENCE=Counter(); LANDMARK_ADJUSTMENTS=[]

def local(geometry): return affine_transform(geometry,AFFINE)
def polygons(geometry):
    if geometry.is_empty: return []
    if geometry.geom_type=='Polygon': return [geometry]
    return [part for geom in getattr(geometry,'geoms',[]) for part in polygons(geom)]
def lines(geometry):
    if geometry.is_empty: return []
    if geometry.geom_type=='LineString': return [geometry]
    return [part for geom in getattr(geometry,'geoms',[]) for part in lines(geom)]
def number(value):
    if value is None: return None
    match=re.search(r'-?\d+(?:\.\d+)?',str(value))
    result=float(match.group()) if match else None
    return result if result is not None and math.isfinite(result) else None
def emit(kind,data,extension):
    digest=hashlib.sha256(data).hexdigest(); filename=f'{kind}/{digest[:20]}.{extension}'
    path=OUT/filename; path.parent.mkdir(parents=True,exist_ok=True)
    if not path.exists(): path.write_bytes(data)
    RESOURCES[filename]={'file':filename,'sha256':digest,'bytes':len(data)}
    return filename
def emit_json(kind,data):
    binary=json.dumps(data,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode()
    return emit(kind,gzip.compress(binary,compresslevel=8,mtime=0),'json.gz')

class Terrain:
    def __init__(self):
        data=np.load(RAW/'terrain.npz'); raw=data['heights']; w,s,e,n=data['bounds']; h,width=raw.shape
        self.bounds=[(w-ORIGIN['lon'])*MLON,(ORIGIN['lat']-n)*MLAT,(e-ORIGIN['lon'])*MLON,(ORIGIN['lat']-s)*MLAT]
        self.dx=(self.bounds[2]-self.bounds[0])/width; self.dz=(self.bounds[3]-self.bounds[1])/h
        # DSM contains roofs and trees: use an explicitly estimated low-frequency
        # ground surface, sharing samples across all tiles to avoid terrain seams.
        ground=gaussian_filter(percentile_filter(raw,percentile=20,size=7,mode='nearest'),sigma=2,mode='nearest')
        self.reference=float(CFG['terrain']['referenceHeightM']); self.heights=ground-self.reference
        self.min=float(self.heights.min()); self.max=float(self.heights.max())
    def height(self,x,z):
        ix=max(0,min(self.heights.shape[1]-1,(x-self.bounds[0])/self.dx-0.5))
        iz=max(0,min(self.heights.shape[0]-1,(z-self.bounds[1])/self.dz-0.5))
        x0,z0=int(ix),int(iz); x1=min(x0+1,self.heights.shape[1]-1); z1=min(z0+1,self.heights.shape[0]-1)
        tx,tz=ix-x0,iz-z0
        return float((1-tz)*((1-tx)*self.heights[z0,x0]+tx*self.heights[z0,x1])+tz*((1-tx)*self.heights[z1,x0]+tx*self.heights[z1,x1]))
    def grid(self,bounds,step):
        nx=math.ceil((bounds[2]-bounds[0])/step); nz=math.ceil((bounds[3]-bounds[1])/step)
        return {'width':nx+1,'height':nz+1,'origin':bounds[:2],'step':step,'heights':[self.height(bounds[0]+x*step,bounds[1]+z*step) for z in range(nz+1) for x in range(nx+1)]}

class Mesh:
    def __init__(self,ox,oz): self.ox,self.oz=ox,oz; self.pos=[]; self.col=[]; self.idx=[]
    def vertex(self,x,y,z,color):
        index=len(self.pos)//3; self.pos.extend([x-self.ox,y,z-self.oz]); self.col.extend(color); return index
    def emit(self,name):
        if not self.pos: return None
        position=np.asarray(self.pos,dtype=np.float64)
        if not np.isfinite(position).all(): raise RuntimeError(f'{name}: nonfinite positions')
        quant=np.rint(position/0.2)
        if (np.abs(quant)>32767).any(): raise RuntimeError(f'{name}: int16 overflow; refusing silent clamping')
        count=len(position)//3; indices=np.asarray(self.idx,dtype='<u4')
        if indices.size and int(indices.max())>=count: raise RuntimeError(f'{name}: vertex index overflow')
        binary=struct.pack('<II',count,len(indices))+quant.astype('<i2').tobytes()+np.asarray(self.col,dtype=np.uint8).tobytes()+indices.tobytes()
        return {'file':emit('tiles',gzip.compress(binary,compresslevel=8,mtime=0),'bin.gz'),'v':count,'i':len(indices),'q':'i16c'}

def surface(mesh,polygon,color,y):
    rings=[list(polygon.exterior.coords)[:-1]]+[list(ring.coords)[:-1] for ring in polygon.interiors]
    rings=[ring for ring in rings if len(ring)>=3]
    if not rings: return
    coords=np.asarray([point for ring in rings for point in ring],dtype=np.float64)
    ends=np.cumsum([len(ring) for ring in rings],dtype=np.uint32)
    indices=mapbox_earcut.triangulate_float64(coords,ends); offset=len(mesh.pos)//3
    for x,z in coords: mesh.vertex(x,y(x,z) if callable(y) else y,z,color)
    for i in range(0,len(indices),3):
        a,b,c=map(int,indices[i:i+3]); ax,az=coords[a]; bx,bz=coords[b]; cx,cz=coords[c]
        if (bx-ax)*(cz-az)-(bz-az)*(cx-ax)>0: b,c=c,b
        mesh.idx.extend([offset+a,offset+b,offset+c])

def height_for(props,geometry):
    explicit=number(props.get('height')); levels=number(props.get('num_floors',props.get('building:levels')))
    roof_height=number(props.get('roof_height',props.get('roof:height'))) or 0
    if explicit is not None and 1<explicit<700: return explicit,'provided_height'
    if levels is not None and 0<levels<200: return levels*3.2+roof_height,'floor_count_estimate'
    kind=props.get('subtype',props.get('building',props.get('building:part','yes')))
    center=geometry.centroid; old=-5200<center.x<2600 and -1600<center.y<9200
    defaults={'house':6.5,'detached':6.5,'terrace':6.5,'apartments':24,'office':24,'commercial':15,'retail':8,'industrial':9,'warehouse':9,'garage':3,'shed':3,'temple':9,'roof':4}
    return defaults.get(kind,7 if old else 12),'typology_estimate_low_confidence'

def height_basis(props,geometry,height,minimum,confidence,base_cap):
    floors_key='num_floors' if 'num_floors' in props else 'building:levels' if 'building:levels' in props else None
    floors=number(props.get(floors_key)) if floors_key else None
    use_key=next((key for key in ['primary_use','building:use','subtype','building','amenity','building:part'] if props.get(key) not in (None,'','yes','no')),None)
    use=props.get(use_key) if use_key else None
    supplied=number(props.get('height')); roof=number(props.get('roof_height',props.get('roof:height')))
    original_height,original_method=height_for(props,geometry)
    kind=props.get('subtype',props.get('building',props.get('building:part','yes')))
    center=geometry.centroid; central=-5200<center.x<2600 and -1600<center.y<9200
    known_defaults={'house','detached','terrace','apartments','office','commercial','retail','industrial','warehouse','garage','shed','temple','roof'}
    basis={'method':confidence,'originalMethod':original_method,'sourceHeightM':supplied,'sourceFloors':floors,'floorsSourceField':floors_key,'useSourceField':use_key,
        'metresPerFloor':3.2 if original_method=='floor_count_estimate' else None,'sourceRoofHeightM':roof,'roofHeightAddedM':(roof or 0) if original_method=='floor_count_estimate' else None,
        'defaultHeightM':original_height if original_method=='typology_estimate_low_confidence' else None,
        'defaultBuildingType':kind if original_method=='typology_estimate_low_confidence' and kind in known_defaults else None,
        'unclassifiedRegion':('central_historical_area' if central else 'outer_city') if original_method=='typology_estimate_low_confidence' and kind not in known_defaults else None,
        'heightBeforePartCapM':original_height,'parentPartBaseCapM':base_cap,'minimumHeightM':minimum,
        'invalidHeightCorrectionAboveMinimumM':3 if confidence=='invalid_source_height_corrected_estimate' else None,'renderedHeightM':height}
    return floors,use,basis

NAMED_COLORS={'firebrick':[132,53,46],'red':[153,67,56],'darkred':[111,45,41],'brown':[120,87,63],
    'yellow':[186,157,67],'gold':[190,157,65],'orange':[196,136,72],'beige':[198,187,160],'tan':[186,166,131],
    'white':[221,220,211],'black':[54,57,57],'grey':[137,140,138],'gray':[137,140,138],'lightgrey':[181,184,179],
    'lightgray':[181,184,179],'darkgrey':[83,88,87],'darkgray':[83,88,87],'silver':[171,178,177],
    'blue':[69,100,133],'darkblue':[51,74,108],'green':[76,111,81],'darkgreen':[48,79,58],
    'maroon':[111,52,49],'pink':[185,134,132],'purple':[120,98,128],'slategray':[106,122,128]}
def material(props):
    def rgb(value,fallback):
        if not isinstance(value,str): return fallback
        value=value.strip().lower()
        if re.fullmatch(r'#[0-9a-f]{6}',value): return [int(value[i:i+2],16) for i in (1,3,5)]
        if re.fullmatch(r'#[0-9a-f]{3}',value): return [int(value[i]*2,16) for i in (1,2,3)]
        return NAMED_COLORS.get(value,fallback)
    wall=rgb(props.get('facade_color',props.get('building:colour',props.get('building:color'))),[139,159,168] if props.get('facade_material',props.get('building:material'))=='glass' else [169,163,151])
    roof=rgb(props.get('roof_color',props.get('roof:colour',props.get('roof:color'))),[112,109,101])
    return wall,roof

def roof_basis(props,height,minimum):
    kind=props.get('roof_shape',props.get('roof:shape','flat'))
    supplied=number(props.get('roof_height',props.get('roof:height')))
    supported=kind in ('gabled','hipped','pyramidal','skillion')
    roof_part=props.get('building:part')=='roof' or props.get('subtype')=='roof'
    if supplied is not None and supplied>0: rise=supplied; method='source_roof_height'
    elif supported and (roof_part or minimum>0): rise=height-minimum; method='height_minus_minimum_for_elevated_roof_part'
    elif supported: rise=min(3,height*.2); method='roof_rise_estimate_low_confidence'
    else: rise=0; method='flat_source_shape' if kind=='flat' else 'unsupported_shape_flat_approximation'
    rise=min(max(0,rise),height-minimum)
    return {'shape':kind,'supported':supported,'sourceRoofHeightM':supplied,'effectiveRoofHeightM':rise,'heightMethod':method,
        'orientationMethod':'source_downslope_direction' if kind=='skillion' and number(props.get('roof_direction',props.get('roof:direction'))) is not None else 'minimum_rotated_rectangle_estimate',
        'renderedPitchedLods':[0,1] if supported and rise>0 else [],'sourceFacadeColor':props.get('facade_color',props.get('building:colour',props.get('building:color'))),
        'sourceRoofColor':props.get('roof_color',props.get('roof:colour',props.get('roof:color'))),'namedColorMethod':'muted visualization palette; original source color retained'}

def roof_planes(polygon,kind,props):
    """Planar approximation aligned to actual geometry; intersection preserves holes."""
    corners=list(polygon.minimum_rotated_rectangle.exterior.coords)[:4]
    lengths=[math.dist(corners[i],corners[(i+1)%4]) for i in range(2)]
    index=0 if lengths[0]>=lengths[1] else 1; start,end=corners[index],corners[index+1]
    width=max(lengths); depth=min(lengths); a,b=width/2,depth/2
    u=((end[0]-start[0])/width,(end[1]-start[1])/width); v=(-u[1],u[0]); center=polygon.minimum_rotated_rectangle.centroid
    def xy(p,q):return (center.x+u[0]*p+v[0]*q,center.y+u[1]*p+v[1]*q)
    def uv(x,z):return ((x-center.x)*u[0]+(z-center.y)*u[1],(x-center.x)*v[0]+(z-center.y)*v[1])
    if kind=='skillion':
        direction=number(props.get('roof_direction',props.get('roof:direction')))
        down=(math.sin(math.radians(direction)),-math.cos(math.radians(direction))) if direction is not None else v
        projections=[x*down[0]+z*down[1] for x,z in polygon.exterior.coords]; lo,hi=min(projections),max(projections)
        return [(polygon,lambda x,z:max(0,min(1,(hi-x*down[0]-z*down[1])/max(hi-lo,.01))))]
    if kind=='gabled':
        domains=[[(-a,-b),(a,-b),(a,0),(-a,0)],[(-a,0),(a,0),(a,b),(-a,b)]]
        height=lambda x,z:max(0,min(1,1-abs(uv(x,z)[1])/max(b,.01)))
    elif kind=='pyramidal':
        domains=[[(-a,-b),(a,-b),(0,0)],[(a,-b),(a,b),(0,0)],[(a,b),(-a,b),(0,0)],[(-a,b),(-a,-b),(0,0)]]
        height=lambda x,z:max(0,min(1,1-abs(uv(x,z)[0])/max(a,.01),1-abs(uv(x,z)[1])/max(b,.01)))
    else:
        ridge=max(0,a-b)
        domains=[[(-a,-b),(a,-b),(ridge,0),(-ridge,0)],[(a,-b),(a,b),(ridge,0)],[(a,b),(-a,b),(-ridge,0),(ridge,0)],[(-a,b),(-a,-b),(-ridge,0)]]
        height=lambda x,z:max(0,min(1,(a-abs(uv(x,z)[0]))/max(b,.01),1-abs(uv(x,z)[1])/max(b,.01)))
    return [(face,height) for domain in domains for face in polygons(make_valid(polygon.intersection(Polygon([xy(p,q) for p,q in domain])))) if face.area>.001]

def roof_skirts(mesh,polygon,face,color,walltop,height_at):
    # Plane intersections add the ridge vertex to gable ends. Only original
    # exterior/courtyard edges receive skirts; internal plane seams stay open.
    for ring_index,ring in enumerate([face.exterior,*face.interiors]):
        coords=list(ring.coords); signed=sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(coords,coords[1:]))
        if (signed>0 and ring_index==0) or (signed<0 and ring_index>0): coords.reverse()
        for a,b in zip(coords,coords[1:]):
            midpoint=Point((a[0]+b[0])/2,(a[1]+b[1])/2)
            if polygon.boundary.distance(midpoint)>.001: continue
            ya,yb=height_at(*a),height_at(*b)
            if max(ya,yb)<=walltop+.001: continue
            offset=len(mesh.pos)//3
            for x,y,z in [(a[0],walltop,a[1]),(b[0],walltop,b[1]),(b[0],yb,b[1]),(a[0],ya,a[1])]:mesh.vertex(x,y,z,color)
            mesh.idx.extend([offset,offset+1,offset+2,offset,offset+2,offset+3])

def building_mesh(mesh,polygon,base,minimum,height,props,lod,roofs=None):
    wall,roof=material(props); roof_shape=props.get('roof_shape',props.get('roof:shape','flat'))
    basis=roof_basis(props,height,minimum); roof_height=basis['effectiveRoofHeightM']; top=base+height; bottom=base+minimum
    pitched=lod<2 and basis['supported'] and roof_height>0
    walltop=top-roof_height if pitched else top
    if lod==2:
        # Shared roof/wall vertices reduce distant city mass geometry substantially.
        rings=[list(polygon.exterior.coords)[:-1]]+[list(r.coords)[:-1] for r in polygon.interiors]
        coords=np.asarray([point for ring in rings for point in ring],dtype=np.float64)
        ends=np.cumsum([len(ring) for ring in rings],dtype=np.uint32)
        triangles=mapbox_earcut.triangulate_float64(coords,ends); count=len(coords); offset=len(mesh.pos)//3
        for x,z in coords: mesh.vertex(x,bottom,z,[round(c*0.72) for c in wall])
        for x,z in coords: mesh.vertex(x,top,z,roof)
        start=0
        for ring in rings:
            signed=sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(ring,ring[1:]+ring[:1]))
            for j in range(len(ring)):
                a=start+j; b=start+(j+1)%len(ring)
                if signed>0: a,b=b,a
                mesh.idx.extend([offset+a,offset+b,offset+b+count,offset+a,offset+b+count,offset+a+count])
            start+=len(ring)
        for i in range(0,len(triangles),3):
            a,b,c=map(int,triangles[i:i+3]); ax,az=coords[a]; bx,bz=coords[b]; cx,cz=coords[c]
            if (bx-ax)*(cz-az)-(bz-az)*(cx-ax)>0: b,c=c,b
            mesh.idx.extend([offset+count+a,offset+count+b,offset+count+c])
        return
    for ring_index,ring in enumerate([polygon.exterior,*polygon.interiors]):
        if walltop<=bottom+.001: break
        coords=list(ring.coords); signed=sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(coords,coords[1:]))
        if (signed>0 and ring_index==0) or (signed<0 and ring_index>0): coords.reverse()
        for a,b in zip(coords,coords[1:]):
            offset=len(mesh.pos)//3
            for x,y,z,col in [(a[0],bottom,a[1],[round(c*0.72) for c in wall]),(b[0],bottom,b[1],[round(c*0.72) for c in wall]),(b[0],walltop,b[1],wall),(a[0],walltop,a[1],wall)]: mesh.vertex(x,y,z,col)
            mesh.idx.extend([offset,offset+1,offset+2,offset,offset+2,offset+3])
    roof_mesh=roofs if roofs is not None else mesh
    if pitched:
        for face,normalized_height in roof_planes(polygon,roof_shape,props):
            height_at=lambda x,z:walltop+roof_height*normalized_height(x,z)
            surface(roof_mesh,face,roof,height_at)
            roof_skirts(roof_mesh,polygon,face,roof,walltop,height_at)
    else: surface(roof_mesh,polygon,roof,top)

def features(filename): return json.loads((RAW/filename).read_text())['features']
def osm_source_id(value):
    match=re.fullmatch(r'(way|relation)/([0-9]+)|([wr])/?([0-9]+)(?:@[0-9]+)?',str(value))
    if not match: return str(value)
    kind=match.group(1) or {'w':'way','r':'relation'}[match.group(3)]
    return f'{kind}/{match.group(2) or match.group(4)}'

class LandmarkCoverage:
    """Only registered, modelled building footprints; no park/radius clearing."""
    def __init__(self,landmarks):
        self.groups=[]; self.replacements=set()
        for item in landmarks:
            if not item.get('model'): continue
            self.replacements.update(item.get('replacesOSMIds',[]))
            pieces=[polygon for coords in item.get('footprints',[]) if len(coords)>=4 for polygon in polygons(make_valid(local(Polygon(coords))))]
            if pieces: self.groups.append((item['id'],unary_union(pieces)))
        self.geometries=[geometry for _,geometry in self.groups]
        self.tree=STRtree(self.geometries) if self.geometries else None
    def overlap(self,geometry):
        if not self.tree: return [],None
        matches=[int(i) for i in self.tree.query(geometry,predicate='intersects')]
        if not matches: return [],None
        mask=unary_union([self.geometries[i] for i in matches])
        return [self.groups[i][0] for i in matches],mask
    def subtract(self,geometry):
        _,mask=self.overlap(geometry)
        return make_valid(geometry.difference(mask)) if mask is not None else geometry
    def source_geometry(self,geometry,identifier,source):
        names,mask=self.overlap(geometry)
        if mask is None: return polygons(geometry)
        overlap=geometry.intersection(mask).area
        if overlap<1e-6: return polygons(geometry)
        # A near-identical source outline may extend by the Overture encoding grid.
        # Dominant duplicates are removed; adjacent/crossing buildings retain all
        # geometry outside the exact registered model coverage.
        removed=overlap/geometry.area>0.65
        retained=[] if removed else polygons(make_valid(geometry.difference(mask)))
        retained=[part for part in retained if part.area>=6]
        STATS[f'landmark_{"replaced" if removed else "clipped"}_{source}']+=1
        LANDMARK_ADJUSTMENTS.append({'id':identifier,'source':source,'landmarks':names,'action':'duplicate_removed' if removed else 'overlap_clipped',
            'originalAreaM2':geometry.area,'overlapAreaM2':overlap,'retainedAreaM2':sum(part.area for part in retained)})
        return retained

def buildings_for(osm,overture,scope,landmarks,coverage=None):
    coverage=coverage or LandmarkCoverage(landmarks)
    replacements=coverage.replacements; osm_buildings=[]; osm_ids=set()
    for feature in osm:
        props=feature['properties']
        if 'building' not in props and 'building:part' not in props: continue
        if feature['id'] in replacements: STATS['landmark_replaced_osm']+=1; continue
        for geometry in polygons(make_valid(local(shape(feature['geometry']))).intersection(scope)):
            if geometry.area<6: continue
            for retained in coverage.source_geometry(geometry,feature['id'],'osm'):
                osm_buildings.append({'id':feature['id'],'geometry':retained,'properties':props,'source':'osm','part':bool(props.get('building:part'))}); osm_ids.add(feature['id'])
    osm_geometries=[item['geometry'] for item in osm_buildings]
    osm_tree=STRtree(osm_geometries) if osm_geometries else None; result=list(osm_buildings)
    for feature in overture:
        props=feature['properties']; is_part=props.get('themeLayer')=='building_part'; original_sources=props.get('sources',[])
        if props.get('is_underground') is True: STATS['underground_buildings_omitted']+=1; continue
        if isinstance(original_sources,str):
            try: original_sources=json.loads(original_sources)
            except ValueError: original_sources=[]
        source_ids={osm_source_id(source.get('record_id','')) for source in original_sources if 'openstreetmap' in str(source.get('dataset','')).lower()}
        if source_ids.intersection(replacements): STATS['landmark_replaced_overture']+=1; continue
        if source_ids.intersection(osm_ids): STATS['deduplicated_overture']+=1; continue
        for geometry in polygons(make_valid(local(shape(feature['geometry']))).intersection(scope)):
            if geometry.area<6: continue
            for retained in coverage.source_geometry(geometry,feature['id'],'overture'):
                if osm_tree and any(retained.intersection(osm_geometries[i]).area/max(retained.area,osm_geometries[i].area)>0.65 for i in osm_tree.query(retained,predicate='intersects')): STATS['deduplicated_overture']+=1; continue
                result.append({'id':feature['id'],'geometry':retained,'properties':props,'source':'overture','part':is_part,'sources':original_sources})
    parts=[item for item in result if item['part']]; tree=STRtree([item['geometry'] for item in parts]) if parts else None; cleaned=[]; extents=set()
    for item in result:
        geometry=item['geometry']
        base_cap=None
        if not item['part'] and tree:
            contained=[parts[i] for i in tree.query(geometry,predicate='intersects') if geometry.intersection(parts[i]['geometry']).area/parts[i]['geometry'].area>0.90]
            grounded=[part['geometry'] for part in contained if (number(part['properties'].get('min_height')) or 0)<=0]
            raised=[number(part['properties'].get('min_height')) for part in contained if (number(part['properties'].get('min_height')) or 0)>0]
            if grounded: geometry=make_valid(geometry.difference(unary_union(grounded)))
            if raised: base_cap=min(raised)
            if contained: STATS['parents_trimmed_to_parts']+=1
        for polygon in polygons(geometry):
            if polygon.area<6: continue
            copy=dict(item); copy['geometry']=polygon; height,confidence=height_for(copy['properties'],polygon)
            if base_cap is not None: height=min(height,base_cap); confidence+=':base_under_elevated_parts'
            minimum=number(copy['properties'].get('min_height'))
            if minimum is None: minimum=(number(copy['properties'].get('building:min_level')) or 0)*3.2
            minimum=max(0,minimum)
            if height<=minimum: height=minimum+3; confidence='invalid_source_height_corrected_estimate'
            extent=(normalize(polygon).wkb,round(height,3),round(minimum,3))
            if extent in extents: STATS['identical_building_volumes_removed']+=1; continue
            extents.add(extent)
            floors,use,basis=height_basis(copy['properties'],polygon,height,minimum,confidence,base_cap)
            copy.update(floors=floors,use=use,heightInferenceBasis=basis)
            copy.update(height=height,minimum=minimum,confidence=confidence,roofGeometry=roof_basis(copy['properties'],height,minimum)); HEIGHT_CONFIDENCE[confidence]+=1; cleaned.append(copy)
    return cleaned

ROAD_WIDTH={'motorway':16,'trunk':14,'primary':12,'secondary':10,'tertiary':8,'residential':6,'unclassified':6,'living_street':5,'service':4,'pedestrian':6,'footway':2,'path':2,'cycleway':2}
def surfaces_for(osm,scope):
    roads=[]; water=[]; green=[]; trees=[]; seen=set()
    for feature in osm:
        props=feature['properties']; geometry=make_valid(local(shape(feature['geometry']))); key=(feature['id'],geometry.geom_type)
        if key in seen: STATS['deduplicated_osm']+=1; continue
        seen.add(key); geometry=geometry.intersection(scope)
        if geometry.is_empty: continue
        highway=props.get('highway'); is_road=highway in ROAD_WIDTH or str(highway).endswith('_link')
        if props.get('railway') in ('rail','light_rail'): highway='rail'; is_road=True
        if is_road:
            explicit=number(props.get('width')); lanes=number(props.get('lanes')); default=4 if highway=='rail' else ROAD_WIDTH.get(highway,6)
            width=explicit if explicit and 1<explicit<80 else lanes*3.2 if lanes and 0<lanes<12 else default
            # Individual dual-carriageway ways are not assigned the entire road width.
            roads.extend({'id':feature['id'],'geometry':line,'properties':props,'width':width} for line in lines(geometry) if len(line.coords)>=2)
            roads.extend({'id':feature['id'],'geometry':polygon,'properties':props,'width':width} for polygon in polygons(geometry))
        if props.get('natural')=='water' or props.get('water') or props.get('waterway') in ('riverbank','dock'):
            water.extend({'id':feature['id'],'geometry':polygon,'properties':props} for polygon in polygons(geometry) if polygon.area>4)
        elif props.get('waterway') in ('river','stream','canal'):
            width=number(props.get('width')) or {'river':18,'canal':10,'stream':3}[props['waterway']]
            water.extend({'id':feature['id'],'geometry':polygon,'properties':props} for line in lines(geometry) for polygon in polygons(line.buffer(width/2,cap_style='flat',join_style='round')))
        if props.get('leisure') in ('park','garden','pitch','golf_course') or props.get('landuse') in ('grass','forest','meadow','recreation_ground','village_green','cemetery') or props.get('natural') in ('wood','scrub','beach'):
            green.extend({'id':feature['id'],'geometry':polygon,'properties':props} for polygon in polygons(geometry) if polygon.area>8)
        if props.get('natural')=='tree' and geometry.geom_type=='Point': trees.append({'id':feature['id'],'geometry':geometry,'scale':number(props.get('height')) or 5})
    return roads,water,green,trees

def main():
    start=time.monotonic(); boundary=json.loads((OUT/CFG['boundaryFile']).read_text())
    if not boundary['properties']['verified']: raise RuntimeError('Refusing unverified scope')
    source_records=json.loads((RAW/'sources.json').read_text())
    required=['osm','overture','dem','imagery']
    incomplete=[key for key in required if not source_records.get(key,{}).get('complete')]
    if incomplete: raise RuntimeError(f'Refusing bake: required acquisition incomplete: {incomplete}')
    if source_records['overture']['release']!=CFG['overtureRelease'] or source_records['imagery']['product']!=CFG['imagery']['product']:
        raise RuntimeError('Refusing bake: acquired snapshots differ from pinned world configuration')
    if any(source_records[key].get('scopeBufferM',0)!=CFG.get('scopeBufferM',0) for key in ['osm','overture']):
        raise RuntimeError('Refusing bake: required geographic snapshots do not cover the configured visual buffer')
    scope=unary_union([local(shape(boundary['geometry'])).buffer(CFG.get('scopeBufferM',0)),local(box(*CFG['extensionBounds']))]); bounds=list(scope.bounds)
    osm=features('osm.geojson'); overture=features('overture.geojson'); registry=json.loads((ROOT/'config/landmarks.json').read_text())
    terrain=Terrain(); imagery=Image.open(RAW/'sentinel.jpg'); landmark_coverage=LandmarkCoverage(registry.get('landmarks',[]))
    buildings=buildings_for(osm,overture,scope,registry.get('landmarks',[]),landmark_coverage)
    roads,water,green,trees=surfaces_for(osm,scope)
    STATS.update(buildings=len(buildings),roads=len(roads),water=len(water),green=len(green),trees=len(trees),infill=0)
    STATS['pitchedRoofVolumes']=sum(bool(item['roofGeometry']['renderedPitchedLods']) for item in buildings)
    STATS['estimatedRoofRiseVolumes']=sum(item['roofGeometry']['heightMethod']=='roof_rise_estimate_low_confidence' for item in buildings)
    print(f'Normalized {dict(STATS)}; height confidence={dict(HEIGHT_CONFIDENCE)}',flush=True)
    layers={'buildings':buildings,'roads':roads,'water':water,'green':green,'trees':trees}; indexes={key:STRtree([item['geometry'] for item in items]) for key,items in layers.items()}
    tiles=[]; by_id={}
    for lod in [2,1,0]:
        size=CFG['tileSizes'][lod]
        for cx in range(math.floor(bounds[0]/size),math.floor(bounds[2]/size)+1):
            for cz in range(math.floor(bounds[1]/size),math.floor(bounds[3]/size)+1):
                tile_bounds=[cx*size,cz*size,(cx+1)*size,(cz+1)*size]; tile_box=box(*tile_bounds)
                if not tile_box.intersects(scope): continue
                ox=(cx+0.5)*size; oz=(cz+0.5)*size; tile_id=f'l{lod}_x{cx}_z{cz}'; meshes={key:Mesh(ox,oz) for key in ['buildings','roads','water','green','roofs']}
                collision={'bounds':tile_bounds,'buildings':[],'water':[],'waterHoles':[]}; source_index=[]
                for i in indexes['buildings'].query(tile_box,predicate='intersects'):
                    item=buildings[int(i)]; polygon=item['geometry']; center=polygon.representative_point()
                    if not (tile_bounds[0]<=center.x<tile_bounds[2] and tile_bounds[1]<=center.y<tile_bounds[3]): continue
                    if lod==2 and item['height']<18 and polygon.area<500: STATS['farSmallBuildingsRepresentedByImagery']+=1; continue
                    simplified=polygon if lod==0 else polygon.simplify(1.5 if lod==1 else 4,preserve_topology=True); base=terrain.height(center.x,center.y)
                    # Simplification can expand an outline back across a landmark.
                    # Reapply the same exact mask for every display level.
                    for rendered_polygon in polygons(landmark_coverage.subtract(simplified)):
                        if rendered_polygon.area>=0.01: building_mesh(meshes['buildings'],rendered_polygon,base,item['minimum'],item['height'],item['properties'],lod,meshes['roofs'])
                    if lod==0:
                        rings=[list(polygon.exterior.coords)[:-1]]+[list(r.coords)[:-1] for r in polygon.interiors]
                        collision['buildings'].append({'id':item['id'],'polygon':rings[0],'holes':rings[1:],'minY':base+item['minimum'],'maxY':base+item['height']})
                        source_index.append({'id':item['id'],'source':item['source'],'heightConfidence':item['confidence'],'height':item['height'],'minHeight':item['minimum'],'floors':item['floors'],'use':item['use'],'heightInferenceBasis':item['heightInferenceBasis'],'roofShape':item['properties'].get('roof_shape',item['properties'].get('roof:shape','flat')),'roofGeometry':item['roofGeometry'],'originalSources':item.get('sources',[])})
                for key in ['roads','water','green']:
                    for i in indexes[key].query(tile_box,predicate='intersects'):
                        item=layers[key][int(i)]; geometry=item['geometry']; props=item['properties']
                        if key=='roads':
                            highway=props.get('highway','rail'); cls=highway.replace('_link','')
                            if lod==2 and cls not in ('motorway','trunk','primary','rail'): continue
                            if lod==1 and cls in ('footway','path','service','living_street','cycleway'): continue
                            if geometry.geom_type=='LineString': geometry=geometry.buffer(item['width']/2,cap_style='flat',join_style='mitre',mitre_limit=2)
                            layer=max(0,min(5,number(props.get('layer')) or 0)); elevated=6*max(1,layer) if props.get('bridge') not in (None,'no') else 0
                            if props.get('tunnel') not in (None,'no'): continue
                            offset=0.20+elevated; color=[69,71,73] if highway!='pedestrian' else [152,145,131]
                        elif key=='water': offset=0.08; color=[51,91,103]
                        else: offset=0.06; color=[83,108,72] if props.get('natural')!='beach' else [190,178,141]
                        for polygon in polygons(make_valid(geometry.intersection(tile_box))):
                            if polygon.area<1: continue
                            if lod>0: polygon=polygon.simplify(1 if lod==1 else 10,preserve_topology=True)
                            surface(meshes[key],polygon,color,lambda x,z:terrain.height(x,z)+offset)
                            if lod==0 and key=='water':
                                collision['water'].append(list(polygon.exterior.coords)[:-1])
                                collision['waterHoles'].append([list(ring.coords)[:-1] for ring in polygon.interiors])
                descriptors={key:value for key,mesh in meshes.items() if (value:=mesh.emit(f'{tile_id}/{key}')) is not None}
                step=62.5 if lod==0 else 125 if lod==1 else 500; grid=terrain.grid(tile_bounds,step); n=grid['width']-1; heights=grid['heights']; ground=Mesh(ox,oz)
                for z in range(n+1):
                    for x in range(n+1): ground.vertex(tile_bounds[0]+x*step,heights[z*(n+1)+x],tile_bounds[1]+z*step,[255,255,255])
                for z in range(n):
                    for x in range(n):
                        a=z*(n+1)+x; ground.idx.extend([a,a+n+1,a+1,a+1,a+n+1,a+n+2])
                ts=64 if lod==0 else 256 if lod==1 else 512; tb=terrain.bounds
                image_box=((tile_bounds[0]-tb[0])/(tb[2]-tb[0])*imagery.width,(tile_bounds[1]-tb[1])/(tb[3]-tb[1])*imagery.height,(tile_bounds[2]-tb[0])/(tb[2]-tb[0])*imagery.width,(tile_bounds[3]-tb[1])/(tb[3]-tb[1])*imagery.height)
                texture=imagery.crop(image_box).resize((ts,ts),Image.Resampling.LANCZOS); blob=io.BytesIO(); texture.save(blob,format='JPEG',quality=85)
                tile={'id':tile_id,'lod':lod,'size':size,'bounds':tile_bounds,'ox':ox,'oz':oz,'meshes':descriptors,'ground':{'mesh':ground.emit(f'{tile_id}/ground'),'texture':{'file':emit('imagery',blob.getvalue(),'jpg'),'bounds':tile_bounds,'mime':'image/jpeg'},'estimatedFromDSM':True},'complete':True}
                if lod==2: tile['representation']='larger/taller source buildings and primary roads; small structures represented by Sentinel imagery'
                if lod==0:
                    collision['ground']=grid; tile['collision']={'file':emit_json('collision',collision)}; tile['sourceIndex']={'file':emit_json('sources',source_index)}; tree_records=[]
                    for i in indexes['trees'].query(tile_box,predicate='intersects'):
                        item=trees[int(i)]; point=item['geometry']
                        if tile_bounds[0]<=point.x<tile_bounds[2] and tile_bounds[1]<=point.y<tile_bounds[3]: tree_records.append([point.x-ox,point.y-oz,item['scale']])
                    if tree_records:
                        binary=struct.pack('<I',len(tree_records))+np.asarray(tree_records,dtype='<f4').tobytes(); tile['trees']={'file':emit('tiles',gzip.compress(binary,mtime=0),'bin.gz'),'count':len(tree_records)}
                tiles.append(tile); by_id[tile_id]=tile
            print(f'LOD{lod} x={cx}: {len(tiles)} cumulative tiles',flush=True)
    for tile in tiles:
        if tile['lod']>0:
            child_lod=tile['lod']-1; child_size=CFG['tileSizes'][child_lod]; x0,z0,x1,z1=tile['bounds']
            tile['children']=[identifier for x in range(round(x0/child_size),round(x1/child_size)) for z in range(round(z0/child_size),round(z1/child_size)) if (identifier:=f'l{child_lod}_x{x}_z{z}') in by_id]
    car_paths=[]
    for item in roads:
        if item['properties'].get('highway') in ('motorway','trunk','primary','secondary') and item['geometry'].geom_type=='LineString' and item['geometry'].length>100 and item['properties'].get('bridge') in (None,'no'):
            car_paths.append(list(item['geometry'].coords))
            if len(car_paths)>=500: break
    binary=bytearray(struct.pack('<I',len(car_paths)))
    for coordinates in car_paths: binary.extend(struct.pack('<I',len(coordinates))); binary.extend(np.asarray(coordinates,dtype='<f4').tobytes())
    cars={'file':emit('traffic',gzip.compress(binary,mtime=0),'bin.gz'),'count':len(car_paths)}; traffic_ground={'file':emit_json('terrain',terrain.grid(bounds,100))}
    sources=json.loads((RAW/'sources.json').read_text()); STATS['leafTiles']=sum(tile['lod']==0 for tile in tiles); STATS['tiles']=len(tiles)
    STATS['vertices']=sum(mesh['v'] for tile in tiles for mesh in tile['meshes'].values()); STATS['triangles']=sum(mesh['i']//3 for tile in tiles for mesh in tile['meshes'].values())
    manifest={'version':2,'origin':ORIGIN,'bounds':bounds,'tiles':tiles,'cars':cars,'trafficGround':traffic_ground,'coverage':{'boundaryFile':CFG['boundaryFile'],'verified':True,'scope':CFG['scope'],'bufferM':CFG.get('scopeBufferM',0),'date':sources['osm']['date'],'complete':{key:value['complete'] for key,value in sources.items()},'completenessMeaning':'Required snapshot tiles acquired and processed; does not guarantee real-world building coverage or currency'},'sources':[{'id':key,**value} for key,value in sources.items()],'stats':dict(STATS),'heightConfidence':dict(HEIGHT_CONFIDENCE),'dataEncoding':{'mesh':'gzip little-endian i16c; positions 0.2m relative to tile center, RGB uint8, indices uint32','jsonAssets':'gzip UTF-8 JSON; original double precision coordinates retained','sourceIndex':'one record per rendered building volume, source floors/use nullable, explicit heightInferenceBasis and original provider provenance','collisionWaterHoles':'waterHoles[i] contains inner rings for water[i]'},'terrain':{'bounds':terrain.bounds,'referenceHeightM':terrain.reference,'heightRange':[terrain.min,terrain.max],'sourceType':'DSM','method':'150m lower-percentile filtering and smoothing; estimated ground, not surveyed DTM'}}
    manifest['roofGeometry']={'supportedShapes':['gabled','hipped','pyramidal','skillion'],'pitchedLods':[0,1],'orientation':'minimum rotated rectangle, with source downslope direction for skillion when supplied',
        'holeHandling':'Each planar face intersects the original polygon including interior rings','confidence':'Planar approximation; original source roof metadata and colors retained, not a measured ornate roof reconstruction','roofLayer':'Non-window vertex-color material'}
    manifest['landmarkCoverage']={'file':emit_json('sources',{'method':'Exact registered model footprints, same rule for OSM and Overture; dominant duplicate volumes removed, crossing geometry clipped; re-applied after every LOD simplification',
        'registrySha256':hashlib.sha256((ROOT/'config/landmarks.json').read_bytes()).hexdigest(),'dominantOverlapRatio':0.65,'adjustments':LANDMARK_ADJUSTMENTS}),
        'registrySha256':hashlib.sha256((ROOT/'config/landmarks.json').read_bytes()).hexdigest(),'adjustedVolumes':len(LANDMARK_ADJUSTMENTS)}
    boundary_bytes=(OUT/CFG['boundaryFile']).read_bytes(); RESOURCES[CFG['boundaryFile']]={'file':CFG['boundaryFile'],'sha256':hashlib.sha256(boundary_bytes).hexdigest(),'bytes':len(boundary_bytes)}
    manifest['assets']=[{'file':resource['file'],'hash':resource['sha256'],'bytes':resource['bytes']} for resource in sorted(RESOURCES.values(),key=lambda item:item['file'])]
    manifest['revision']=hashlib.sha256(json.dumps(manifest,sort_keys=True,separators=(',',':')).encode()).hexdigest()[:20]
    (OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':'),allow_nan=False))
    qa={'revision':manifest['revision'],'durationSeconds':round(time.monotonic()-start,1),'stats':manifest['stats'],'heightConfidence':manifest['heightConfidence'],'sources':sources,'boundary':boundary['properties'],'checks':{'realClosedBoundary':True,'syntheticBuildings':False,'nonfiniteVertices':0,'outOfRangeIndices':0,'int16ClampedVertices':0,'holesPreserved':True,'partsParentOverlapRemoved':True},'limitations':['Official Overture z14 vector tiles have approximately 0.46m encoding grid precision in Beijing, not surveyed accuracy or full-resolution GeoParquet geometry.','Unknown heights are explicitly low-confidence typology estimates.','Ground is a filtered DSM estimate; satellite imagery resolution is 10m, not street/facade photography.']}
    qa['checks']['allReferencedResourcesPresent']=all((OUT/resource['file']).exists() for resource in manifest['assets'])
    (OUT/'data-qa.json').write_text(json.dumps(qa,ensure_ascii=False,indent=2))
    CFG['worldBounds']=bounds; (ROOT/'config/world.json').write_text(json.dumps(CFG,ensure_ascii=False,indent=2)+'\n')
    print(f'Baked revision={manifest["revision"]}: {len(tiles)} tiles, {len(RESOURCES)} resources, {time.monotonic()-start:.1f}s',flush=True)

if __name__=='__main__': main()
