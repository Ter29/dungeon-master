import type { LocationBackground } from './locations.js';
export type CartographyPoint={x:number;y:number};
export type MapFragmentView={id:string;name:string;issued:boolean;revision:number;image:LocationBackground|null};
export type MapElementView={id:string;kind:'NOTE'|'MARKER'|'LINE'|'ROUTE'|'CONTOUR'|'FRAGMENT';text:string;color:string;x:number;y:number;points:CartographyPoint[];scale:number;rotation:number;locked:boolean;revision:number;fragmentId:string|null;fragment:MapFragmentView|null};
export type SharedMapSummary={id:string;name:string;description:string;width:number;height:number;available:boolean;revision:number;dataVersion:number;background:LocationBackground|null};
export type SharedMapView=SharedMapSummary&{elements:MapElementView[]};
export type CartographyCatalog={maps:SharedMapSummary[];fragments:MapFragmentView[];storageAvailable:boolean};
