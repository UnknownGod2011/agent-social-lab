async(page)=>{
  await page.setViewportSize({width:1440,height:1000});
  await page.emulateMedia({reducedMotion:"no-preference"});
  await page.goto("http://127.0.0.1:8055");
  const canvas=page.locator("h1 .tech-text-canvas");
  await canvas.waitFor();
  await page.mouse.move(1420,900);
  await page.waitForTimeout(550);
  const measure=await canvas.evaluate(c=>{
    const pixels=c.getContext("2d").getImageData(0,0,c.width,c.height).data;
    let left=c.width,right=-1;
    for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(pixels[(y*c.width+x)*4+3]>180){left=Math.min(left,x);right=Math.max(right,x)}
    return {width:c.width,left,right,css:c.getBoundingClientRect().width};
  });
  if(measure.right>=measure.width-1 || measure.right <=measure.left) throw Error("Clipped or missing TechText: "+JSON.stringify(measure));
  const still=await canvas.screenshot(),bounds=await canvas.boundingBox();
  await page.mouse.click(bounds.x+bounds.width*.4,bounds.y+bounds.height*.5);
  await page.waitForTimeout(110);
  if(still.equals(await canvas.screenshot())) throw Error("TechText did not react to pointer");
  await page.evaluate(()=>{
    const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,...args){return type.startsWith("webgl")?null:original.call(this,type,...args)};
  });
  await page.getByLabel("Featured department").selectOption("A");
  await page.locator(".scan-fallback").waitFor();
  await page.getByRole("heading",{name:"Focus studio"}).waitFor();
  await page.locator(".department-scan").waitFor({state:"hidden"});
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.getByLabel("Featured department").selectOption("B");
  await page.getByRole("heading",{name:"Reflection nook"}).waitFor();
  if(await page.locator(".department-scan").count()) throw Error("Reduced motion still showed scan");
  return {header:measure,reactiveTitle:true,webglFallback:true,reducedTransition:true};
}
