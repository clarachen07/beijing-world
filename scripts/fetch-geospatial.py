"""Acquire and normalize real, redistributable Beijing geospatial data.

Sources are pinned and recorded; raw input stays in ignored raw/geospatial.
No boundary is synthesized: the scope must be a node-connected OSM cycle.
"""
from __future__ import annotations
import argparse, concurrent.futures, gzip, hashlib, heapq, json, math, re, time
from pathlib import Path
import requests
import osmium
from shapely.geometry import LineString, Polygon, box, mapping, shape
from shapely.affinity import affine_transform
from shapely.ops import unary_union
from pmtiles.reader import Reader
from pmtiles.tile import Compression
import mapbox_vector_tile

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'raw/geospatial'
OUT = ROOT / 'public/data/coverage'
CONFIG = json.loads((ROOT / 'config/world.json').read_text())
UA = 'beijing-world/2.0 (open city visualization; read-only geographic data build)'
DEM_LICENSE='https://docs.sentinel-hub.com/api/latest/static/files/data/dem/resources/license/License-COPDEM-30.pdf'
DEM_ATTRIBUTION='produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved'
DEM_DISCLAIMER='依法或经授权负责 Copernicus 计划的机构不对任何 Copernicus WorldDEM-30 使用承担责任。后续分发须继续保留归属、修改说明与许可义务；本项目不代表提供机构认可。'
RING_NAME = re.compile(r'^[东西南北]四环[东西南北中]路$')
SESSION = requests.Session()
SESSION.headers['User-Agent'] = UA

def save_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')))

def sha(path):
    return hashlib.file_digest(path.open('rb'), 'sha256').hexdigest()

def download(url, path):
    if path.exists() and path.stat().st_size > 1000:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with SESSION.get(url, stream=True, timeout=(15, 120)) as response:
        response.raise_for_status()
        with path.with_suffix(path.suffix + '.part').open('wb') as dest:
            for chunk in response.iter_content(1024 * 1024):
                dest.write(chunk)
    path.with_suffix(path.suffix + '.part').replace(path)

def source_record(key, data):
    path = RAW / 'sources.json'
    records = json.loads(path.read_text()) if path.exists() else {}
    records[key] = data
    save_json(path, records)

def scope_geometry(boundary):
    """Buffer the source ring in shared local metres, then return WGS84 scope."""
    origin=CONFIG['origin']; mx=111320*math.cos(math.radians(origin['lat'])); mz=CONFIG['projection']['metresPerDegreeLat']
    forward=[mx,0,0,-mz,-origin['lon']*mx,origin['lat']*mz]
    inverse=[1/mx,0,0,-1/mz,origin['lon'],origin['lat']]
    ring=affine_transform(boundary,forward).buffer(CONFIG.get('scopeBufferM',0))
    extension=affine_transform(box(*CONFIG['extensionBounds']),forward)
    return affine_transform(unary_union([ring,extension]),inverse)

class OSMHandler(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.factory = osmium.geom.GeoJSONFactory()
        self.features, self.trunks, self.errors = [], [], []
        self.area_fallbacks = {}
    def node(self, node):
        if node.tags.get('natural') == 'tree':
            self.features.append({'type':'Feature', 'id':f'node/{node.id}', 'properties':dict(node.tags), 'geometry':{'type':'Point','coordinates':[node.location.lon,node.location.lat]}})
    def way(self, way):
        tags = dict(way.tags)
        if not any(key in tags for key in ('highway','waterway','railway','building','building:part','natural','landuse','leisure')):
            return
        try:
            coords = [[node.lon,node.lat] for node in way.nodes]
        except osmium.InvalidLocationError:
            self.errors.append(f'way/{way.id}:missing-nodes')
            return
        if len(coords) < 2:
            return
        if coords[0] == coords[-1] and len(coords)>=4:
            self.area_fallbacks[f'way/{way.id}']={'type':'Feature','id':f'way/{way.id}','properties':tags,'geometry':{'type':'Polygon','coordinates':[coords]}}
        if not any(key in tags for key in ('highway','waterway','railway')): return
        if tags.get('highway') in ('trunk','motorway','primary'):
            self.trunks.append({'id':way.id,'nodes':[node.ref for node in way.nodes],'coords':coords,'tags':tags})
        if tags.get('area') == 'yes' and coords[0] == coords[-1]:
            return  # area callback provides the actual polygon with relation holes
        self.features.append({'type':'Feature','id':f'way/{way.id}','properties':tags,'geometry':{'type':'LineString','coordinates':coords}})
    def area(self, area):
        tags = dict(area.tags)
        if not any(key in tags for key in ('building','building:part','natural','landuse','leisure','water','waterway','highway')):
            return
        if tags.get('landuse')=='government' and not any(key in tags for key in ('building','building:part','natural','leisure','water','waterway','highway')): return
        identifier = f'{"way" if area.from_way() else "relation"}/{area.orig_id()}'
        try:
            geom = json.loads(self.factory.create_multipolygon(area))
        except (RuntimeError, osmium.InvalidLocationError) as error:
            fallback=self.area_fallbacks.get(identifier)
            if fallback:
                from shapely import make_valid
                repaired=make_valid(shape(fallback['geometry']))
                if not repaired.is_empty and repaired.geom_type in ('Polygon','MultiPolygon'):
                    fallback['geometry']=mapping(repaired); fallback['properties']=dict(tags,geometry_repaired=True)
                    self.features.append(fallback); return
            self.errors.append(f'{identifier}:{error}')
            return
        self.features.append({'type':'Feature','id':identifier,'properties':tags,'geometry':geom})

def ring_cycles(trunks):
    selected = [way for way in trunks if way['tags'].get('highway') in ('trunk','motorway') and RING_NAME.fullmatch(way['tags'].get('name',''))]
    edges, points = {}, {}
    for way in selected:
        for node, coord in zip(way['nodes'],way['coords']): points[node] = coord
        for a,b in zip(way['nodes'],way['nodes'][1:]):
            edges[tuple(sorted((a,b)))] = way['id']
    adjacency = {}
    for a,b in edges:
        adjacency.setdefault(a,set()).add(b); adjacency.setdefault(b,set()).add(a)
    endpoints = [node for node,neighbours in adjacency.items() if len(neighbours) == 1]
    if endpoints:
        # Supplement only short, real OSM paths. No coordinates are interpolated.
        named_lines = unary_union([LineString(way['coords']) for way in selected])
        ring_corridor = named_lines.buffer(0.01)
        graph = {}
        for way in trunks:
            line = LineString(way['coords'])
            if not line.intersects(ring_corridor): continue
            for node,coord in zip(way['nodes'],way['coords']): points[node] = coord
            for a,b in zip(way['nodes'],way['nodes'][1:]):
                pa,pb = points[a],points[b]
                distance = math.hypot((pa[0]-pb[0])*85300,(pa[1]-pb[1])*111132)
                graph.setdefault(a,[]).append((b,distance,way['id']))
                graph.setdefault(b,[]).append((a,distance,way['id']))
        pending = set(endpoints)
        while pending:
            start = min(pending); pending.remove(start)
            queue = [(0,start,[])]; seen = set(); result = None
            while queue:
                distance,node,path = heapq.heappop(queue)
                if node in seen or distance > 2500: continue
                seen.add(node)
                if node in pending:
                    result = (node,path); break
                for other,length,way_id in graph.get(node,[]):
                    if tuple(sorted((node,other))) in edges: continue
                    heapq.heappush(queue,(distance+length,other,path+[(node,other,way_id)]))
            if result is None:
                raise RuntimeError(f'Fourth ring has unmatched real OSM endpoint {start} at {points[start]}; refusing synthetic closure')
            end,path = result; pending.remove(end)
            for a,b,way_id in path:
                edges[tuple(sorted((a,b)))] = way_id
                adjacency.setdefault(a,set()).add(b); adjacency.setdefault(b,set()).add(a)
    branching = {node:len(neighbours) for node,neighbours in adjacency.items() if len(neighbours) != 2}
    if branching: raise RuntimeError(f'Fourth ring graph is not closed degree-two topology: {branching}')
    unused = set(edges); cycles = []
    while unused:
        a,b = min(unused); route = [a]; ids = []; current,previous = a,None
        while True:
            neighbours = adjacency[current]
            nxt = next(node for node in sorted(neighbours) if node != previous)
            edge = tuple(sorted((current,nxt)))
            if edge not in unused: raise RuntimeError('Cycle reused an edge before closing')
            unused.remove(edge); ids.append(edges[edge]); route.append(nxt)
            previous,current = current,nxt
            if current == a: break
        polygon = Polygon([points[node] for node in route])
        if not polygon.is_valid: raise RuntimeError('Fourth ring real cycle self-intersects')
        if polygon.contains(shape({'type':'Point','coordinates':[116.391,39.907]})):
            cycles.append({'polygon':polygon,'nodes':route,'wayIds':sorted(set(ids))})
    if len(cycles) != 2: raise RuntimeError(f'Expected two carriageway cycles around inner Beijing; found {len(cycles)}')
    cycles.sort(key=lambda cycle:cycle['polygon'].area)
    return cycles

def fetch_osm():
    pbf = RAW / 'Beijing.osm.pbf'
    url = 'https://download.bbbike.org/osm/bbbike/Beijing/Beijing.osm.pbf'
    download(url,pbf)
    handler = OSMHandler(); handler.apply_file(str(pbf), locations=True, idx='flex_mem')
    print(f'OSM: {len(handler.features)} real features, {len(handler.trunks)} main-road ways, {len(handler.errors)} geometry omissions',flush=True)
    save_json(RAW / 'osm-main-roads.json',handler.trunks)
    save_json(RAW / 'osm-geometry-omissions.json',handler.errors)
    cycles = ring_cycles(handler.trunks)
    boundary = cycles[0]['polygon']
    feature = {'type':'Feature','properties':{'scope':'fourth-ring-main-carriageway-interior','verified':True,'method':'OSM node-connected degree-two graph cycles; no synthetic links','nodeCount':len(cycles[0]['nodes']),'uniqueNodeCount':len(set(cycles[0]['nodes'])),'nodeCountIncludesClosingPoint':True,'wayIds':cycles[0]['wayIds'],'carriageways':2,'bounds':list(boundary.bounds)},'geometry':mapping(boundary)}
    save_json(OUT / 'fourth-ring.geojson',feature)
    save_json(RAW / 'fourth-ring-nodes.json', {'cycles':[{'nodes':cycle['nodes'],'wayIds':cycle['wayIds']} for cycle in cycles]})
    scope = scope_geometry(boundary)
    features = []
    for feature in handler.features:
        geometry = shape(feature['geometry'])
        if not geometry.is_empty and geometry.intersects(scope): features.append(feature)
    save_json(RAW / 'osm.geojson',{'type':'FeatureCollection','features':features})
    with osmium.io.Reader(str(pbf)) as reader:
        timestamp = reader.header().get('osmosis_replication_timestamp')
    source_record('osm',{'provider':'OpenStreetMap contributors via BBBike','url':url,'license':'ODbL-1.0','date':timestamp,'sha256':sha(pbf),'complete':not handler.errors,'omittedGeometryCount':len(handler.errors),'scope':CONFIG['scope'],'scopeBufferM':CONFIG.get('scopeBufferM',0),'featureCount':len(features)})
    landmark_features = [feature for feature in features if any(name in feature['properties'].get('name','') for name in ['方泽','皇祇','朝日','夕月','地坛','日坛','月坛'])]
    save_json(RAW / 'landmark-osm.geojson',{'type':'FeatureCollection','features':landmark_features})
    print(f'Fourth Ring: {len(cycles[0]["nodes"])} nodes, {len(cycles[0]["wayIds"])} real ways, bounds={boundary.bounds}; scoped OSM={len(features)}',flush=True)

def tile_xy(lon,lat,z):
    return int((lon+180)/360*2**z), int((1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*2**z)

def fetch_overture():
    boundary = shape(json.loads((OUT / 'fourth-ring.geojson').read_text())['geometry'])
    scope = scope_geometry(boundary)
    release = CONFIG['overtureRelease']; z = 14
    url = f'https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/{release}/buildings.pmtiles'
    cache = RAW / 'overture-pmtiles'; cache.mkdir(parents=True,exist_ok=True)
    byte_cache = {}
    def get_bytes(offset,length):
        key = (offset,length)
        if key not in byte_cache:
            response = SESSION.get(url,headers={'Range':f'bytes={offset}-{offset+length-1}'},timeout=(15,90))
            response.raise_for_status()
            if response.status_code != 206: raise RuntimeError('Remote PMTiles server does not support bounded range reads')
            byte_cache[key] = response.content
        return byte_cache[key]
    reader = Reader(get_bytes); header = reader.header()
    w,s,e,n = scope.bounds; x0,y0 = tile_xy(w,n,z); x1,y1 = tile_xy(e,s,z)
    features = {}; missing = []; total = (x1-x0+1)*(y1-y0+1)
    for ix,x in enumerate(range(x0,x1+1)):
        for y in range(y0,y1+1):
            tilepath = cache / f'{z}-{x}-{y}.pbf'
            if tilepath.exists(): data = tilepath.read_bytes()
            else:
                data = reader.get(z,x,y)
                if data is None: missing.append([z,x,y]); continue
                if header['tile_compression'] == Compression.GZIP: data = gzip.decompress(data)
                tilepath.write_bytes(data)
            layers = mapbox_vector_tile.decode(data,default_options={'y_coord_down':True})
            for layername,layer in layers.items():
                extent = layer['extent']
                def transform_coords(coords):
                    if isinstance(coords[0],(int,float)):
                        gx = (x+coords[0]/extent)/2**z; gy = (y+coords[1]/extent)/2**z
                        return [gx*360-180,math.degrees(math.atan(math.sinh(math.pi*(1-2*gy))))]
                    return [transform_coords(item) for item in coords]
                for source in layer['features']:
                    geometry = dict(source['geometry']); geometry['coordinates'] = transform_coords(geometry['coordinates'])
                    polygon = shape(geometry)
                    if polygon.is_empty or not polygon.intersects(scope): continue
                    props = source['properties']; identifier = str(props.get('id',source.get('id')))
                    if not identifier: continue
                    key = f'{layername}/{identifier}'
                    # Adjacent vector tiles clip geometry; unite pieces by persistent Overture ID.
                    if key in features:
                        features[key]['geometry'] = mapping(unary_union([shape(features[key]['geometry']),polygon]))
                    else:
                        props = dict(props); props['themeLayer'] = layername
                        features[key] = {'type':'Feature','id':key,'properties':props,'geometry':mapping(polygon)}
        print(f'Overture tiles: {(ix+1)*(y1-y0+1)}/{total}, unique features={len(features)}',flush=True)
    save_json(RAW / 'overture.geojson',{'type':'FeatureCollection','features':list(features.values())})
    source_record('overture',{'provider':'Overture Maps Foundation','release':release,'url':url,'license':'ODbL-1.0 (building theme; original per-feature sources retained)','date':release,'complete':not missing,'missingTiles':missing,'requiredTileCount':total,'scopeBufferM':CONFIG.get('scopeBufferM',0),'featureCount':len(features),'encoding':'official vector tile geometry at z14, not full-resolution GeoParquet','coordinateQuantizationM':round(40075016.686*math.cos(math.radians((s+n)/2))/(2**z*extent),2),'vectorTileZoom':z,'vectorTileExtent':extent,'geometryAccuracyNote':'Encoding grid precision is not surveyed positional accuracy; tiles may simplify original provider geometry.','sha256':sha(RAW / 'overture.geojson')})

def fetch_rasters():
    import rasterio
    from rasterio.warp import reproject, Resampling
    from rasterio.transform import from_bounds
    import numpy as np
    boundary = shape(json.loads((OUT / 'fourth-ring.geojson').read_text())['geometry'])
    scope = scope_geometry(boundary); w,s,e,n = scope.bounds
    origin = CONFIG['origin']; mx = 111320*math.cos(math.radians(origin['lat'])); mz=111132
    # Ground imagery must cover complete root tiles, including their scope margins.
    # Otherwise Pillow pads the outside of the source crop with black pixels.
    root_size=max(CONFIG['tileSizes'])
    xmin=math.floor((w-origin['lon'])*mx/root_size)*root_size
    xmax=math.ceil((e-origin['lon'])*mx/root_size)*root_size
    zmin=math.floor((origin['lat']-n)*mz/root_size)*root_size
    zmax=math.ceil((origin['lat']-s)*mz/root_size)*root_size
    w,s,e,n=origin['lon']+xmin/mx,origin['lat']-zmax/mz,origin['lon']+xmax/mx,origin['lat']-zmin/mz
    dem_url='https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com/Copernicus_DSM_COG_10_N39_00_E116_00_DEM/Copernicus_DSM_COG_10_N39_00_E116_00_DEM.tif'
    download(dem_url,RAW/'dem-n39-e116.tif')
    if n > 40:
        download(dem_url.replace('N39_00','N40_00'),RAW/'dem-n40-e116.tif')
    width=math.ceil((e-w)*mx/50); height=math.ceil((n-s)*mz/50)
    grid=np.full((height,width),np.nan,dtype=np.float32); transform=from_bounds(w,s,e,n,width,height)
    for path in sorted(RAW.glob('dem-n*-e116.tif')):
        with rasterio.open(path) as source:
            reproject(rasterio.band(source,1),grid,src_transform=source.transform,src_crs=source.crs,dst_transform=transform,dst_crs='EPSG:4326',dst_nodata=np.nan,init_dest_nodata=False,resampling=Resampling.bilinear)
    if not np.isfinite(grid).all(): raise RuntimeError('DSM crop has missing pixels; refusing invented terrain')
    np.savez_compressed(RAW/'terrain.npz',heights=grid,bounds=np.array([w,s,e,n]))
    source_record('dem',{'provider':'Copernicus / DLR / Airbus; public COG by Sinergise','url':dem_url,'license':'COP-DEM-GLO-30-F free and open','licenseUrl':DEM_LICENSE,'attribution':DEM_ATTRIBUTION,'disclaimer':DEM_DISCLAIMER,'date':'2021 release, observations primarily 2011–2015','complete':True,'resolutionM':30,'type':'DSM, contains buildings and vegetation','verticalDatum':'EGM2008','sha256':sha(RAW/'terrain.npz'),'pixelBounds':[w,s,e,n]})
    product=CONFIG['imagery']['product']; image_url=CONFIG['imagery']['visualHref']
    width=math.ceil((e-w)*mx/10); height=math.ceil((n-s)*mz/10)
    pixels=np.zeros((3,height,width),dtype=np.uint8); transform=from_bounds(w,s,e,n,width,height)
    # Read bounded COG windows with GDAL rather than downloading an entire scene.
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR',CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif',GDAL_HTTP_TIMEOUT='90',GDAL_HTTP_MAX_RETRY='2'):
        with rasterio.open(image_url) as source:
            for band in range(1,4):
                reproject(rasterio.band(source,band),pixels[band-1],src_transform=source.transform,src_crs=source.crs,dst_transform=transform,dst_crs='EPSG:4326',resampling=Resampling.bilinear)
    from PIL import Image
    Image.fromarray(pixels.transpose(1,2,0)).save(RAW/'sentinel.jpg',quality=92)
    if not np.all(pixels.max(axis=0)>0): raise RuntimeError('Sentinel crop has missing RGB pixels; refusing partial imagery')
    source_record('imagery',{'provider':'ESA Copernicus Sentinel-2 / Element84 public COG','url':image_url,'product':product,'date':CONFIG['imagery']['date'],'license':'Copernicus Sentinel Data Legal Notice','attribution':f'Contains modified Copernicus Sentinel data {CONFIG["imagery"]["date"][:4]}','complete':True,'resolutionM':10,'sceneCloudPercent':CONFIG['imagery']['sceneCloudPercent'],'sha256':sha(RAW/'sentinel.jpg'),'pixelBounds':[w,s,e,n]})
    print(f'DSM: {grid.shape}, Sentinel RGB: {pixels.shape}',flush=True)

if __name__ == '__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--only',choices=['osm','overture','rasters','all'],default='all'); args=parser.parse_args()
    RAW.mkdir(parents=True,exist_ok=True)
    if args.only in ('osm','all'): fetch_osm()
    if args.only in ('overture','all'): fetch_overture()
    if args.only in ('rasters','all'): fetch_rasters()
