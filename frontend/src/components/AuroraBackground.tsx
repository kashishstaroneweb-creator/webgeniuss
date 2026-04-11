import React from 'react';

export function AuroraBackground() {
  return (
    <div className="fixed inset-0 z-[-1] overflow-hidden bg-black pointer-events-none">
      {/* 
        We use an absolute positioned container and overlapping 
        blurred circles to create an 'Aurora' mesh effect. 
        Theme: Black / Green
      */}
      <div className="absolute top-[-10%] left-[-10%] w-[50vw] h-[50vw] rounded-full mix-blend-screen filter blur-[100px] bg-emerald-900/30 animate-blob" />
      <div className="absolute top-[20%] right-[-10%] w-[40vw] h-[40vw] rounded-full mix-blend-screen filter blur-[100px] bg-green-800/20 animate-blob animation-delay-2000" />
      <div className="absolute bottom-[-20%] left-[20%] w-[60vw] h-[60vw] rounded-full mix-blend-screen filter blur-[120px] bg-teal-900/40 animate-blob animation-delay-4000" />
      
      {/* A dark overlay grid to give it a slightly technical texture */}
      <div 
        className="absolute inset-0 opacity-20 pointer-events-none" 
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%2322c55e' fill-opacity='0.15'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }}
      />
    </div>
  );
}
