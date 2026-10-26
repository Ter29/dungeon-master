import type {LocationBackground} from './locations.js';
export type DisplayMode='TABLE'|'ILLUSTRATION'|'PORTRAIT'|'BLANK';
export type PresentationCategory='LOCATION'|'NPC'|'EVENT';
export type PresentationMaterialView={id:string;name:string;description:string;category:PresentationCategory;revision:number;image:LocationBackground|null};
export type DirectorSnapshot={version:number;mode:DisplayMode;material:PresentationMaterialView|null};
export type DirectorLibrary={materials:PresentationMaterialView[];storageAvailable:boolean};
