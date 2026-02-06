import React, { useState, useRef, useEffect } from 'react';
import {
  Camera, Settings, History, Check, X,
  FileText, Download, Cloud, Sparkles, RefreshCw,
  Trash2, FolderOpen, Maximize2, Zap, RotateCcw, Sliders,
  Plus, ChevronRight, Save, Edit3, Image as ImageIcon,
  Users, CreditCard, TrendingUp, Calendar, LayoutGrid
} from 'lucide-react';
import { AppStep, FilterType, ProcessingState, ScanResult, PageData } from './types';
import { analyzeDocument } from './services/geminiService';
import { generatePDF, simulateCloudUpload } from './services/pdfService';
import { GoogleGenerativeAI } from '@google/generative-ai';

const App: React.FC = () => {
  const [step, setStep] = useState<AppStep>(AppStep.IDLE);
  const [pages, setPages] = useState<PageData[]>([]);
  const [activePageIndex, setActivePageIndex] = useState<number | null>(null);
  const [scanHistory, setScanHistory] = useState<ScanResult[]>([]);

  const [onedrivePath, setOnedrivePath] = useState(() =>
    localStorage.getItem('onedrive_path') || 'OneDrive/Compartida/Escaneos_Socio'
  );
  const [manualFileName, setManualFileName] = useState('');

  const [showSettings, setShowSettings] = useState(false);
  const [companyLogo, setCompanyLogo] = useState(() => localStorage.getItem('company_logo') || '');
  const [companyStamp, setCompanyStamp] = useState(() => localStorage.getItem('company_stamp') || '');
  const [userSignature, setUserSignature] = useState(() => localStorage.getItem('user_signature') || '');

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    localStorage.setItem('onedrive_path', onedrivePath);
    localStorage.setItem('company_logo', companyLogo);
    localStorage.setItem('company_stamp', companyStamp);
    localStorage.setItem('user_signature', userSignature);
  }, [onedrivePath, companyLogo, companyStamp, userSignature]);

  // Manejo del botón atrás del móvil
  useEffect(() => {
    const handleBackButton = (e: PopStateEvent) => {
      if (showSettings) {
        setShowSettings(false);
        e.preventDefault();
      } else if (step !== AppStep.IDLE) {
        setStep(AppStep.IDLE);
        setPages([]);
        e.preventDefault();
      }
    };
    window.addEventListener('popstate', handleBackButton);
    // Añadimos un estado inicial para poder capturar el primer "atrás"
    window.history.pushState({ path: window.location.pathname }, '');
    return () => window.removeEventListener('popstate', handleBackButton);
  }, [step, showSettings]);

  const addStamp = (pageIndex: number, type: 'custom' | 'paid' | 'urgent' | 'pending', imageUrl?: string) => {
    const newStamp = {
      id: Date.now().toString(),
      type,
      x: 50,
      y: 50,
      scale: 1,
      imageUrl
    };
    setPages((prev: PageData[]) => {
      const updated = [...prev];
      const p = updated[pageIndex];
      updated[pageIndex] = {
        ...p,
        processing: { ...p.processing, stamps: [...(p.processing.stamps || []), newStamp] }
      };
      return updated;
    });
  };

  const removeStamp = (pageIndex: number, stampId: string) => {
    setPages((prev: PageData[]) => {
      const updated = [...prev];
      const p = updated[pageIndex];
      updated[pageIndex] = {
        ...p,
        processing: { ...p.processing, stamps: (p.processing.stamps || []).filter(s => s.id !== stampId) }
      };
      return updated;
    });
  };

  const updateStampPosition = (pageIndex: number, stampId: string, x: number, y: number) => {
    setPages((prev: PageData[]) => {
      const updated = [...prev];
      const p = updated[pageIndex];
      const stamps = (p.processing.stamps || []).map(s => s.id === stampId ? { ...s, x, y } : s);
      updated[pageIndex] = { ...p, processing: { ...p.processing, stamps } };
      return updated;
    });
  };

  const startCamera = async () => {
    try {
      setStep(AppStep.CAPTURE);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (err) {
      alert("Error: Activa los permisos de cámara.");
      setStep(AppStep.IDLE);
    }
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        const newPage: PageData = {
          id: Date.now().toString(),
          original: dataUrl,
          processed: dataUrl,
          processing: { brightness: 100, contrast: 120, saturation: 100, filter: 'clean' }
        };
        setPages(prev => [...prev, newPage]);
      }
    }
  };

  const applyFilterToPage = (index: number, state: ProcessingState) => {
    const page = pages[index];
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        let fs = `brightness(${state.brightness}%) contrast(${state.contrast}%) saturate(${state.saturation}%)`;
        if (state.filter === 'grayscale') fs += ' grayscale(100%)';
        if (state.filter === 'clean') fs += ' contrast(180%) brightness(110%) grayscale(100%)';
        if (state.filter === 'high-contrast') fs += ' contrast(240%) brightness(105%) grayscale(100%)';
        if (state.filter === 'vibrant') fs += ' saturate(160%) contrast(110%)';

        ctx.filter = fs;
        ctx.drawImage(img, 0, 0);
        const processedUrl = canvas.toDataURL('image/jpeg', 0.9);
        setPages((prev: PageData[]) => {
          const updated = [...prev];
          updated[index] = { ...updated[index], processed: processedUrl, processing: state };
          return updated;
        });
      }
    };
    img.src = page.original;
  };

  const finalizeAndSave = async (mode: 'local' | 'onedrive') => {
    setIsUploading(true);
    const finalImages = pages.map(p => p.processed);

    if (mode === 'local') {
      generatePDF(pages, manualFileName);
    } else {
      await simulateCloudUpload(onedrivePath, manualFileName);
      alert(`Éxito: Archivo subido a la carpeta compartida: ${onedrivePath}`);
    }

    setScanHistory((prev: ScanResult[]) => [{
      id: Date.now().toString(),
      pages: finalImages,
      ocrText: ocrResult?.text || '',
      category: ocrResult?.category || 'General',
      timestamp: Date.now(),
      fileName: manualFileName,
      isQuestionnaire: ocrResult?.isQuestionnaire
    }, ...prev]);

    setIsUploading(false);
    setPages([]);
    setStep(AppStep.IDLE);
  };

  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [ocrResult, setOcrResult] = useState<any>(null);

  return (
    <div className="min-h-screen flex flex-col p-6 max-w-4xl mx-auto pb-32">
      {/* HEADER CORPORATIVO */}
      <header className="flex items-center justify-between mb-8 animate-in slide-in-from-top duration-500">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 bg-white rounded-2xl shadow-md border border-slate-100 flex items-center justify-center p-1 font-black text-3xl tracking-tighter overflow-hidden">
            {companyLogo ? (
              <img src={companyLogo} className="w-full h-full object-contain" />
            ) : (
              <>
                <span className="text-slate-800">D</span>
                <div className="flex flex-col -mt-1 scale-75">
                  <span className="text-[12px] text-slate-500 leading-none">k</span>
                  <span className="text-[12px] text-slate-500 leading-none">o</span>
                  <span className="text-[12px] text-slate-500 leading-none">m</span>
                </div>
              </>
            )}
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-800 leading-none">ScanerDLKom</h1>
            <p className="text-[11px] uppercase font-bold tracking-[0.2em] text-indigo-500 mt-1">Gestión Pro</p>
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => window.location.reload()}
            className="w-12 h-12 bg-white rounded-full shadow-sm border border-slate-100 flex items-center justify-center text-slate-400 active:rotate-180 transition-all"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="w-12 h-12 bg-indigo-50 rounded-full shadow-sm border border-indigo-100 flex items-center justify-center text-indigo-500 active:scale-95 transition-all"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main className="flex-1 flex flex-col gap-6">
        {step === AppStep.IDLE && (
          <div className="grid grid-cols-2 gap-6 pt-2">
            {/* Tarjeta de Nuevo Escaneo */}
            <div
              onClick={startCamera}
              className="col-span-2 bg-white rounded-[40px] p-12 shadow-sm border border-slate-100 flex flex-col items-center justify-center gap-4 group cursor-pointer active:scale-95 transition-all"
            >
              <div className="bg-indigo-50 w-24 h-24 rounded-[32px] flex items-center justify-center group-hover:scale-110 transition-all">
                <Camera className="w-10 h-10 text-indigo-500" />
              </div>
              <h2 className="text-3xl font-black text-slate-800">Nuevo Escaneo</h2>
            </div>

            {/* Accesos Rápidos Estilo Matriz */}
            <button
              onClick={() => setStep(AppStep.HISTORY)}
              className="bg-white rounded-[32px] p-8 shadow-sm border border-slate-100 flex flex-col items-center gap-4 hover:bg-slate-50 transition-all group"
            >
              <div className="w-16 h-16 bg-purple-100 rounded-2xl flex items-center justify-center text-purple-600 group-hover:rotate-6 transition-all shadow-sm">
                <History className="w-8 h-8" />
              </div>
              <span className="text-sm font-bold text-slate-700">Historial</span>
            </button>

            <button
              className="bg-white rounded-[32px] p-8 shadow-sm border border-slate-100 flex flex-col items-center gap-4 hover:bg-slate-50 transition-all group"
            >
              <div className="w-16 h-16 bg-rose-100 rounded-2xl flex items-center justify-center text-rose-600 group-hover:-rotate-6 transition-all shadow-sm">
                <CreditCard className="w-8 h-8" />
              </div>
              <span className="text-sm font-bold text-slate-700">Gastos</span>
            </button>
          </div>
        )}

        {step === AppStep.CAPTURE && (
          <div className="relative h-[70vh] rounded-[48px] overflow-hidden bg-black shadow-2xl">
            <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover opacity-90" />
            <div className="absolute top-8 left-8 bg-white/90 backdrop-blur-md px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-800 border border-white/20">
              {pages.length} ESCANEOS
            </div>
            <div className="absolute bottom-12 inset-x-0 px-10 flex justify-between items-center">
              <div className="w-16 h-16 bg-white/20 backdrop-blur-md rounded-2xl border border-white/20 overflow-hidden shadow-xl">
                {pages.length > 0 && <img src={pages[pages.length - 1].processed} className="w-full h-full object-cover" />}
              </div>
              <button
                onClick={capturePhoto}
                className="w-20 h-20 bg-white rounded-full border-[6px] border-white/20 active:scale-95 transition-all shadow-2xl flex items-center justify-center"
              >
                <div className="w-14 h-14 rounded-full border-2 border-slate-200" />
              </button>
              <button
                onClick={() => { (videoRef.current?.srcObject as MediaStream).getTracks().forEach(t => t.stop()); setStep(AppStep.REVIEW); }}
                className="w-16 h-16 bg-emerald-500 rounded-2xl flex items-center justify-center shadow-emerald-500/30 shadow-2xl active:scale-95 transition-all"
              >
                <Check className="w-8 h-8 text-white" />
              </button>
            </div>
          </div>
        )}

        {step === AppStep.REVIEW && (
          <div className="flex flex-col gap-6 animate-in slide-in-from-bottom duration-500">
            <div className="flex justify-between items-center px-2">
              <h2 className="text-2xl font-black text-slate-800">Review ({pages.length})</h2>
              <button onClick={startCamera} className="w-12 h-12 bg-indigo-50 rounded-2xl text-indigo-500 flex items-center justify-center shadow-sm active:scale-95 transition-all">
                <Plus className="w-6 h-6" />
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-5">
              {pages.map((p, i) => (
                <div key={p.id} className="relative group bg-white rounded-[32px] p-2 shadow-sm border border-slate-100 transition-all hover:translate-y-[-4px]">
                  <img src={p.processed} className="rounded-[24px] aspect-[3/4] object-cover" onClick={() => { setActivePageIndex(i); setStep(AppStep.EDIT); }} />
                  <div className="absolute top-4 left-4 bg-slate-800 text-white w-7 h-7 rounded-xl text-[10px] flex items-center justify-center font-black">{i + 1}</div>
                  <button onClick={() => setPages(pages.filter((_, idx) => idx !== i))} className="absolute -top-3 -right-3 bg-rose-500 text-white p-2.5 rounded-full shadow-lg border-4 border-[#f8fafc]"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
            <button
              onClick={async () => { setIsAiProcessing(true); const res = await analyzeDocument(pages[0].processed); setOcrResult(res); setManualFileName(res.suggestedFileName); setStep(AppStep.FINAL_PREVIEW); setIsAiProcessing(false); }}
              className="w-full py-6 bg-slate-900 text-white rounded-[32px] font-black text-lg shadow-xl shadow-slate-900/20 flex items-center justify-center gap-3 active:scale-[0.98] transition-all"
            >
              {isAiProcessing ? <RefreshCw className="w-6 h-6 animate-spin" /> : <ChevronRight className="w-6 h-6" />}
              Procesar con IA
            </button>
          </div>
        )}

        {step === AppStep.EDIT && activePageIndex !== null && (
          <div className="flex flex-col gap-6 animate-in zoom-in-95 duration-300">
            <div className="flex justify-between items-center px-2">
              <button onClick={() => setStep(AppStep.REVIEW)} className="w-12 h-12 bg-white rounded-2xl text-slate-400 flex items-center justify-center shadow-sm border border-slate-100"><RotateCcw className="w-5 h-5" /></button>
              <h3 className="font-black text-slate-800">Editar Página</h3>
              <button onClick={() => setStep(AppStep.REVIEW)} className="bg-emerald-500 text-white px-8 py-3.5 rounded-2xl font-black shadow-lg shadow-emerald-500/20 active:scale-95 transition-all">Hecho</button>
            </div>

            <div className="bg-white rounded-[40px] p-3 aspect-[3/4] flex items-center justify-center shadow-xl border border-slate-100 relative overflow-hidden">
              <img src={pages[activePageIndex].processed} className="max-h-full rounded-[24px]" />
              {pages[activePageIndex].processing.stamps?.map((s) => (
                <div
                  key={s.id}
                  className="absolute cursor-move group select-none"
                  style={{ left: `${s.x}%`, top: `${s.y}%`, transform: `translate(-50%, -50%) scale(${s.scale})` }}
                  onTouchMove={(e) => {
                    const rect = e.currentTarget.parentElement?.getBoundingClientRect();
                    if (rect) {
                      const touch = e.touches[0];
                      const x = ((touch.clientX - rect.left) / rect.width) * 100;
                      const y = ((touch.clientY - rect.top) / rect.height) * 100;
                      updateStampPosition(activePageIndex, s.id, x, y);
                    }
                  }}
                >
                  {s.type === 'custom' ? (
                    <img src={s.imageUrl} className="h-20 object-contain pointer-events-none opacity-80" />
                  ) : (
                    <div className={`px-4 py-2 border-[4px] font-black text-xl uppercase tracking-tighter rounded rotate-[-12deg] pointer-events-none opacity-80 ${s.type === 'paid' ? 'border-emerald-500 text-emerald-500' :
                      s.type === 'urgent' ? 'border-rose-500 text-rose-500' :
                        'border-amber-500 text-amber-500'
                      }`}>
                      {s.type === 'paid' ? 'PAGADO' : s.type === 'urgent' ? 'URGENTE' : 'PENDIENTE'}
                    </div>
                  )}
                  <button
                    onClick={() => removeStamp(activePageIndex, s.id)}
                    className="absolute -top-4 -right-4 bg-rose-500 text-white p-2 rounded-full shadow-lg border-2 border-white"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>

            <div className="bg-white rounded-[32px] p-8 shadow-sm border border-slate-100 space-y-8">
              <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                {['clean', 'vibrant', 'grayscale', 'none'].map(f => (
                  <button
                    key={f}
                    onClick={() => applyFilterToPage(activePageIndex!, { ...pages[activePageIndex!].processing, filter: f as any })}
                    className={`px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shrink-0 ${pages[activePageIndex!].processing.filter === f ? 'bg-slate-900 text-white shadow-xl shadow-slate-900/20' : 'bg-slate-50 text-slate-400'}`}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <div className="flex gap-3 overflow-x-auto no-scrollbar">
                <button onClick={() => addStamp(activePageIndex, 'paid')} className="px-6 py-3.5 bg-emerald-50 text-emerald-600 border border-emerald-100 rounded-2xl text-[10px] font-black uppercase tracking-widest shrink-0">PAGADO</button>
                <button onClick={() => addStamp(activePageIndex, 'urgent')} className="px-6 py-3.5 bg-rose-50 text-rose-600 border border-rose-100 rounded-2xl text-[10px] font-black uppercase tracking-widest shrink-0">URGENTE</button>
                {companyStamp && <button onClick={() => addStamp(activePageIndex, 'custom', companyStamp)} className="px-6 py-3.5 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded-2xl text-[10px] font-black uppercase tracking-widest shrink-0">MI SELLO</button>}
                {userSignature && <button onClick={() => addStamp(activePageIndex, 'custom', userSignature)} className="px-6 py-3.5 bg-blue-50 text-blue-600 border border-blue-100 rounded-2xl text-[10px] font-black uppercase tracking-widest shrink-0">MI FIRMA</button>}
              </div>
              <div className="space-y-6">
                <div className="flex items-center gap-5">
                  <Sliders className="w-4 h-4 text-slate-400" />
                  <input type="range" min="50" max="150" value={pages[activePageIndex].processing.brightness} onChange={(e) => applyFilterToPage(activePageIndex!, { ...pages[activePageIndex!].processing, brightness: parseInt(e.target.value) })} className="flex-1 h-2 bg-slate-100 rounded-full appearance-none accent-indigo-500" />
                </div>
                <div className="flex items-center gap-5">
                  <Maximize2 className="w-4 h-4 text-slate-400" />
                  <input type="range" min="50" max="250" value={pages[activePageIndex].processing.contrast} onChange={(e) => applyFilterToPage(activePageIndex!, { ...pages[activePageIndex!].processing, contrast: parseInt(e.target.value) })} className="flex-1 h-2 bg-slate-100 rounded-full appearance-none accent-indigo-500" />
                </div>
              </div>
            </div>
          </div>
        )}

        {step === AppStep.FINAL_PREVIEW && (
          <div className="bg-white rounded-[48px] p-10 space-y-10 animate-in slide-in-from-bottom duration-500 border border-slate-100 shadow-2xl">
            <div className="flex items-center gap-6">
              <div className="bg-emerald-50 p-6 rounded-[32px] border border-emerald-100 text-emerald-500">
                <Save className="w-10 h-10" />
              </div>
              <div className="flex-1">
                <h3 className="text-3xl font-black text-slate-800 tracking-tight">Finalizar</h3>
                <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">{pages.length} páginas • {ocrResult?.category || 'General'}</p>
              </div>
              {ocrResult?.isQuestionnaire && (
                <div className="bg-amber-50 px-5 py-2.5 rounded-2xl flex items-center gap-2 border border-amber-100 animate-bounce">
                  <Sparkles className="w-4 h-4 text-amber-500 fill-amber-500" />
                  <span className="text-[10px] font-black text-amber-600 uppercase">IA Form</span>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] px-1">Nombre profesional sugerido</label>
              <div className="relative">
                <input
                  type="text"
                  value={manualFileName}
                  onChange={(e) => setManualFileName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-100 rounded-[24px] px-8 py-6 font-bold text-slate-700 focus:ring-4 focus:ring-indigo-500/10 outline-none pr-16"
                />
                <Edit3 className="absolute right-8 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300" />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5">
              <button onClick={() => finalizeAndSave('local')} className="bg-slate-900 text-white py-6 rounded-[32px] font-black shadow-xl shadow-slate-900/20 active:scale-95 transition-all text-lg">DESCARGAR PDF</button>
              <button
                onClick={() => finalizeAndSave('onedrive')}
                disabled={isUploading}
                className="bg-white text-indigo-600 border-2 border-indigo-100 py-6 rounded-[32px] font-black shadow-sm active:scale-95 transition-all flex justify-center gap-3 text-lg"
              >
                {isUploading ? <RefreshCw className="animate-spin" /> : <Cloud className="w-6 h-6" />} ONEDRIVE
              </button>
            </div>
          </div>
        )}
      </main>

      {/* SETTINGS MODAL */}
      {showSettings && (
        <div className="fixed inset-0 z-[100] bg-white animate-in slide-in-from-right duration-300 flex flex-col p-8 overflow-y-auto">
          <div className="flex justify-between items-center mb-10">
            <h2 className="text-2xl font-black text-slate-800">Ajustes</h2>
            <button
              onClick={() => setShowSettings(false)}
              className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center"
            >
              <X className="w-6 h-6 text-slate-500" />
            </button>
          </div>

          <div className="space-y-8">
            {/* LOGO EMPRESA */}
            <div className="space-y-3">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-1">Logo de la Empresa</label>
              <div className="bg-slate-50 rounded-[24px] p-6 border border-slate-100 flex flex-col items-center gap-4">
                {companyLogo ? (
                  <div className="relative w-32 h-32 bg-white rounded-2xl p-2 shadow-sm border border-slate-100">
                    <img src={companyLogo} className="w-full h-full object-contain" />
                    <button onClick={() => setCompanyLogo('')} className="absolute -top-3 -right-3 bg-rose-500 text-white p-2 rounded-full shadow-lg"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ) : (
                  <label className="w-32 h-32 border-2 border-dashed border-slate-200 rounded-2xl flex items-center justify-center cursor-pointer hover:bg-white transition-all text-slate-300">
                    <Plus className="w-6 h-6" />
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (re) => setCompanyLogo(re.target?.result as string);
                        reader.readAsDataURL(file);
                      }
                    }} />
                  </label>
                )}
                <span className="text-[10px] text-slate-400 text-center px-4">Este logo aparecerá en el cabezal de la aplicación.</span>
              </div>
            </div>

            {/* SELLOS Y FIRMAS */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-3">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-1">Sello Corporativo</label>
                <div className="bg-slate-50 rounded-[24px] p-4 border border-slate-100 flex flex-col items-center gap-3">
                  {companyStamp ? (
                    <div className="relative w-full h-20 bg-white rounded-xl p-1 shadow-sm border border-slate-100">
                      <img src={companyStamp} className="w-full h-full object-contain" />
                      <button onClick={() => setCompanyStamp('')} className="absolute -top-2 -right-2 bg-rose-500 text-white p-1.5 rounded-full shadow-lg"><Trash2 className="w-3 h-3" /></button>
                    </div>
                  ) : (
                    <label className="w-full h-20 border-2 border-dashed border-slate-200 rounded-xl flex items-center justify-center cursor-pointer hover:bg-white transition-all text-slate-300">
                      <Plus className="w-5 h-5" />
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = (re) => setCompanyStamp(re.target?.result as string);
                          reader.readAsDataURL(file);
                        }
                      }} />
                    </label>
                  )}
                </div>
              </div>
              <div className="space-y-3">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-1">Firma Personal</label>
                <div className="bg-slate-50 rounded-[24px] p-4 border border-slate-100 flex flex-col items-center gap-3">
                  {userSignature ? (
                    <div className="relative w-full h-20 bg-white rounded-xl p-1 shadow-sm border border-slate-100">
                      <img src={userSignature} className="w-full h-full object-contain" />
                      <button onClick={() => setUserSignature('')} className="absolute -top-2 -right-2 bg-rose-500 text-white p-1.5 rounded-full shadow-lg"><Trash2 className="w-3 h-3" /></button>
                    </div>
                  ) : (
                    <label className="w-full h-20 border-2 border-dashed border-slate-200 rounded-xl flex items-center justify-center cursor-pointer hover:bg-white transition-all text-slate-300">
                      <Plus className="w-5 h-5" />
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = (re) => setUserSignature(re.target?.result as string);
                          reader.readAsDataURL(file);
                        }
                      }} />
                    </label>
                  )}
                </div>
              </div>
            </div>

            {/* ONEDRIVE */}
            <div className="space-y-3">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-1">OneDrive Carpetas Compartidas</label>
              <div className="bg-slate-50 rounded-[24px] p-5 border border-slate-100">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-500">
                    <Cloud className="w-5 h-5" />
                  </div>
                  <span className="text-xs text-slate-500 font-medium">Configura la ruta de guardado automático.</span>
                </div>
                <input
                  type="text"
                  value={onedrivePath}
                  onChange={(e) => setOnedrivePath(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-xl px-4 py-4 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
            </div>

            <button
              onClick={() => setShowSettings(false)}
              className="w-full py-5 bg-slate-900 text-white rounded-[24px] font-black text-lg shadow-xl shadow-slate-900/20 mt-4 active:scale-95 transition-all"
            >
              Guardar y Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
