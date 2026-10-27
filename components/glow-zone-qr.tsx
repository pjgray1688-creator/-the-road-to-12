import { accessQrMatrix } from "@/lib/qr-code";

export function GlowZoneQr({value}:{value:string}){
 const matrix=accessQrMatrix(value);const quiet=4;const size=matrix.length+quiet*2;
 const modules=matrix.flatMap((row,y)=>row.map((dark,x)=>dark?`M${x+quiet} ${y+quiet}h1v1h-1z`:"")).join("");
 return <svg className="glow-session-qr" aria-label="Glow Zone session request QR code" role="img" viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges">
  <rect width={size} height={size} fill="white"/><path d={modules} fill="black"/>
 </svg>;
}
