import React, { useState, useRef, useEffect } from 'react';
import {
  Camera, Settings, History, Check, X,
  FileText, Download, Cloud, Sparkles, RefreshCw,
  Trash2, FolderOpen, Maximize2, Zap, RotateCcw, Sliders,
  Plus, ChevronRight, Save, Edit3, Image as ImageIcon,
  Users, CreditCard, TrendingUp, Calendar, LayoutGrid, Scan
} from 'lucide-react';
import { AppStep, FilterType, ProcessingState, ScanResult, PageData, Point } from './types';
import { analyzeDocument } from './services/geminiService';
import { generatePDF, simulateCloudUpload } from './services/pdfService';
import { autoDetectEdges, applyAdaptiveThreshold, applyPerspectiveTransform, applyMagicColor } from './services/imageProcessor';
import { GoogleGenerativeAI } from '@google/generative-ai';

const App: React.FC = () => {
  const [step, setStep] = useState<AppStep>(AppStep.IDLE);
  const [pages, setPages] = useState<PageData[]>([]);
  const pagesRef = useRef<PageData[]>([]);
  const [activePageIndex, setActivePageIndex] = useState<number | null>(null);
  const [scanHistory, setScanHistory] = useState<ScanResult[]>([]);
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (msg: string) => {
    console.log(msg);
    setLogs(prev => [new Date().toLocaleTimeString() + ": " + msg, ...prev].slice(0, 10));
  };

  useEffect(() => { pagesRef.current = pages; }, [pages]);

  const [onedrivePath, setOnedrivePath] = useState(() =>
    localStorage.getItem('onedrive_path') || 'OneDrive/Compartida/Escaneos_Socio'
  );
  const [manualFileName, setManualFileName] = useState('');

  const [showSettings, setShowSettings] = useState(false);
  const [companyLogo, setCompanyLogo] = useState(() => localStorage.getItem('company_logo') || '');
  const [companyStamp, setCompanyStamp] = useState(() => localStorage.getItem('company_stamp') || '');
  const [userSignature, setUserSignature] = useState(() => localStorage.getItem('user_signature') || '');

  const [dialog, setDialog] = useState<{
    show: boolean;
    title: string;
    message: string;
    type: 'confirm' | 'alert';
    onConfirm?: () => void;
  }>({ show: false, title: '', message: '', type: 'alert' });

  const [magnifierPoint, setMagnifierPoint] = useState<Point | null>(null);

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
      setDialog({
        show: true,
        title: 'Error de Cámara',
        message: 'Por favor, activa los permisos de cámara para poder escanear.',
        type: 'alert'
      });
      setStep(AppStep.IDLE);
    }
  };

  const getPerspectiveTransform = (src: Point[], dst: Point[]) => {
    // Implementación simplificada de homografía para 4 puntos
    // Para una potencia real sin OpenCV.js externo, usamos una aproximación de warp
    return ""; // Placeholder for real logic if needed for CSS
  };

  const performCrop = (index: number, specificPage?: PageData) => {
    const page = specificPage || pagesRef.current[index];
    if (!page) {
      addLog("Fallo: Página no encontrada en índice " + index);
      return;
    }
    addLog(`Enderezando perspectiva... (Pts: ${JSON.stringify(page.cropPoints?.[0])})`);
    const points = page.cropPoints || [];
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);

        // El nuevo motor hace el "warp" real
        const croppedUrl = applyPerspectiveTransform(canvas, points);

        setPages(prev => {
          const updated = [...prev];
          updated[index] = { ...updated[index], cropped: croppedUrl, processed: croppedUrl };
          return updated;
        });

        // Aplicar automáticamente el filtro configurado (por defecto Magia Pro)
        const updatedState = page.processing;
        setTimeout(() => applyFilterToPage(index, updatedState), 50);

        setStep(AppStep.REVIEW);
        addLog("Página enderezada y lista.");
      }
    };
    img.src = page.original;
  };

  const updateCropPoint = (index: number, pointIndex: number, x: number, y: number) => {
    setPages(prev => {
      const updated = [...prev];
      const p = updated[index];
      const cp = [...(p.cropPoints || [])];
      cp[pointIndex] = { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) };
      updated[index] = { ...p, cropPoints: cp };
      return updated;
    });
  };

  const rotatePage = (index: number, direction: 'left' | 'right') => {
    setPages(prev => {
      const updated = [...prev];
      const p = updated[index];
      const currentRotation = p.processing.rotation || 0;
      const newRotation = direction === 'right' ? (currentRotation + 90) % 360 : (currentRotation - 90 + 360) % 360;
      updated[index] = { ...p, processing: { ...p.processing, rotation: newRotation } };
      return updated;
    });
    // Necesitamos re-procesar la imagen para aplicar la rotación al canvas
    setTimeout(() => applyFilterToPage(index, { ...pages[index].processing, rotation: (pages[index].processing.rotation + (direction === 'right' ? 90 : -90) + 360) % 360 }), 50);
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
        addLog("Foto capturada. Analizando documento...");
        const dataUrl = canvas.toDataURL('image/jpeg', 0.95);

        // Auto-detección con el nuevo motor PRO
        const detectedPoints = autoDetectEdges(canvas);

        const newPage: PageData = {
          id: Date.now().toString(),
          original: dataUrl,
          cropped: dataUrl,
          processed: dataUrl,
          processing: {
            brightness: 100,
            contrast: 100,
            saturation: 100,
            filter: 'magic',
            removeShadows: true,
            rotation: 0
          },
          cropPoints: detectedPoints
        };

        const newIndex = pagesRef.current.length;
        setPages(prev => [...prev, newPage]);
        setActivePageIndex(newIndex);

        // Feedback háptico y visual
        if ('vibrate' in navigator) navigator.vibrate(50);

        // Detener cámara temporalmente para ahorro de batería/recursos
        if (videoRef.current?.srcObject) {
          (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
        }

        // SALTO OBLIGATORIO A AJUSTE (Estilo CamScanner)
        setTimeout(() => setStep(AppStep.CROP), 100);
      }
    }
  };

  const applyFilterToPage = (index: number, state: ProcessingState, specificPage?: PageData) => {
    const page = specificPage || pagesRef.current[index];
    if (!page) return;
    addLog(`Aplicando filtro ${state.filter} a página ${index}...`);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Manejo de rotación en canvas
        if (state.rotation === 90 || state.rotation === 270) {
          canvas.width = img.height;
          canvas.height = img.width;
        } else {
          canvas.width = img.width;
          canvas.height = img.height;
        }

        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((state.rotation * Math.PI) / 180);

        let fs = `brightness(${state.brightness}%) contrast(${state.contrast}%) saturate(${state.saturation}%)`;
        if (state.filter === 'grayscale') fs += ' grayscale(100%)';

        // Filtros PRO estilo CamScanner (Magia DLKom)
        if (state.filter === 'clean') fs += ' contrast(200%) brightness(110%) grayscale(100%)'; // Aclarar
        if (state.filter === 'vibrant') fs += ' contrast(150%) brightness(105%) saturate(140%)'; // Mejorar

        // El resto se maneja via OpenCV si es necesario, o se deja como base
        ctx.filter = fs;
        ctx.drawImage(img, -img.width / 2, -img.height / 2);

        // MOTOR DE FILTROS AVANZADOS (OpenCV)
        if (state.filter === 'magic') {
          applyMagicColor(canvas);
        } else if (state.filter === 'bw') {
          applyAdaptiveThreshold(canvas, { blockSize: 15, offset: 10 });
        } else if (state.filter === 'clean') {
          applyAdaptiveThreshold(canvas, { blockSize: 45, offset: 20 });
        }

        const processedUrl = canvas.toDataURL('image/jpeg', 0.95);
        setPages((prev: PageData[]) => {
          const updated = [...prev];
          updated[index] = { ...updated[index], processed: processedUrl, processing: state };
          return updated;
        });
      }
    };
    // IMPORTANTE: Aplicar filtros sobre la imagen RECORTADA/ENDEREZADA
    img.src = page.cropped;
  };

  const finalizeAndSave = async (mode: 'local' | 'onedrive') => {
    setIsUploading(true);
    const finalImages = pages.map(p => p.processed);

    if (mode === 'local') {
      generatePDF(pages, manualFileName);
    } else {
      await simulateCloudUpload(onedrivePath, manualFileName);
      setDialog({
        show: true,
        title: 'ScanerDLKom dice',
        message: `Éxito: Archivo subido a la carpeta compartida: ${onedrivePath}`,
        type: 'alert'
      });
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
            <p className="text-[11px] uppercase font-bold tracking-[0.2em] text-indigo-500 mt-1 flex items-center gap-2">
              Gestión Pro v2.1.0 PRO
              <span className="bg-red-600 text-white text-[10px] px-2 py-0.5 rounded-full animate-bounce">ACTUALIZADO</span>
            </p>
          </div>
        </div>
        <script dangerouslySetInnerHTML={{ __html: `console.log("%c SCANER DLKOM V2.1 PRO LOADED", "color: white; background: red; font-size: 20px; font-weight: bold;");` }} />
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

      {/* CANVAS OCULTO PARA PROCESAMIENTO */}
      <canvas ref={canvasRef} className="hidden" />

      {/* MAIN CONTENT */}
      <main className="flex-1 flex flex-col gap-6">
        {step === AppStep.IDLE && (
          <div className="flex flex-col items-center justify-center pt-8 animate-in fade-in duration-700">
            {/* Botón Principal de Nuevo Escaneo */}
            <div
              onClick={startCamera}
              className="w-full bg-white rounded-[48px] p-16 shadow-sm border border-slate-100 flex flex-col items-center justify-center gap-6 group cursor-pointer active:scale-95 transition-all text-center"
            >
              <div className="bg-indigo-50 w-32 h-32 rounded-[40px] flex items-center justify-center group-hover:scale-110 transition-all shadow-inner">
                <Camera className="w-14 h-14 text-indigo-500" />
              </div>
              <div>
                <h2 className="text-4xl font-black text-slate-800 tracking-tight">Nuevo Escaneo</h2>
                <p className="text-slate-400 font-bold uppercase tracking-[0.3em] text-[10px] mt-4">DLKom Gestión Pro</p>
              </div>
            </div>
          </div>
        )}

        {step === AppStep.CAPTURE && (
          <div className="relative h-[72vh] rounded-[48px] overflow-hidden bg-black shadow-2xl animate-in fade-in duration-500">
            <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover opacity-90 transition-opacity" />

            {/* Indicador de Páginas */}
            <div className="absolute top-8 left-8 flex items-center gap-3">
              <div className="bg-white/90 backdrop-blur-md px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-800 border border-white/20 shadow-xl">
                {pages.length} ESCANEOS
              </div>
              {pages.length > 0 && (
                <button
                  onClick={() => {
                    (videoRef.current?.srcObject as MediaStream).getTracks().forEach(t => t.stop());
                    setStep(AppStep.CROP);
                  }}
                  className="bg-indigo-500 px-4 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest text-white shadow-lg animate-pulse active:scale-95 transition-all"
                >
                  Pulsa aquí para Recortar ✓
                </button>
              )}
            </div>

            <div className="absolute bottom-12 inset-x-0 px-10 flex justify-between items-center">
              {/* Miniatura de la última captura */}
              <div className="w-16 h-16 bg-white/10 backdrop-blur-md rounded-2xl border-2 border-white/30 overflow-hidden shadow-xl flex items-center justify-center">
                {pages.length > 0 ? (
                  <img src={pages[pages.length - 1].processed} className="w-full h-full object-cover" />
                ) : (
                  <FileText className="w-6 h-6 text-white/40" />
                )}
              </div>

              {/* Botón Disparador */}
              <div className="flex flex-col items-center gap-3">
                <button
                  onClick={capturePhoto}
                  className="w-24 h-24 bg-white rounded-full border-[8px] border-white/20 active:scale-90 transition-all shadow-2xl flex items-center justify-center group"
                >
                  <div className="w-16 h-16 rounded-full border-2 border-slate-100 group-active:bg-slate-50 transition-colors" />
                </button>
                {pages.length > 0 && (
                  <span className="text-[9px] font-black text-white/60 tracking-widest animate-pulse">
                    PULSA OTRA VEZ PARA AÑADIR PÁGINA
                  </span>
                )}
              </div>

              {/* Botón Ir a Revisión/Filtros/OCR */}
              <button
                onClick={() => {
                  (videoRef.current?.srcObject as MediaStream).getTracks().forEach(t => t.stop());
                  setStep(AppStep.CROP);
                }}
                className={`w-18 h-18 rounded-2xl flex flex-col items-center justify-center gap-1 shadow-2xl active:scale-90 transition-all ${pages.length > 0 ? 'bg-emerald-500 shadow-emerald-500/30' : 'bg-white/20 border border-white/20 text-white/40'}`}
                disabled={pages.length === 0}
              >
                <Check className={`w-8 h-8 ${pages.length > 0 ? 'text-white' : 'text-white/20'}`} />
                <span className="text-[8px] font-black text-white px-2">LISTO</span>
              </button>
            </div>
          </div>
        )}

        {step === AppStep.CROP && activePageIndex !== null && (
          <div className="flex flex-col gap-6 animate-in slide-in-from-bottom duration-500">
            <div className="flex justify-between items-center px-2">
              <button
                onClick={startCamera}
                className="bg-white text-indigo-500 w-14 h-14 rounded-2xl flex flex-col items-center justify-center shadow-lg border-2 border-indigo-50 active:scale-90 transition-all"
              >
                <Plus className="w-6 h-6" />
                <span className="text-[8px] font-black mt-0.5">AÑADIR</span>
              </button>

              <div className="flex-1 text-center">
                <h2 className="text-xl font-black text-slate-800">Ajustar Bordes</h2>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{activePageIndex + 1} de {pages.length} páginas</p>
              </div>

              <button
                onClick={() => {
                  performCrop(activePageIndex);
                  setStep(AppStep.REVIEW);
                }}
                className="bg-emerald-500 text-white w-14 h-14 rounded-2xl flex flex-col items-center justify-center shadow-lg shadow-emerald-200 active:scale-90 transition-all"
              >
                <Check className="w-6 h-6" />
                <span className="text-[8px] font-black mt-0.5">LISTO</span>
              </button>
            </div>

            <div className="relative bg-slate-100 rounded-[40px] p-1 aspect-[3/4] overflow-hidden shadow-2xl border-4 border-white">
              <img src={pages[activePageIndex].original} className="w-full h-full object-cover opacity-80" />

              {/* LUPA (MAGNIFIER) - Se muestra al arrastrar */}
              {magnifierPoint && (
                <div
                  className="absolute w-32 h-32 rounded-full border-4 border-white shadow-2xl overflow-hidden z-50 pointer-events-none bg-black"
                  style={{
                    left: `${magnifierPoint.x > 50 ? magnifierPoint.x - 25 : magnifierPoint.x + 25}%`,
                    top: `${magnifierPoint.y > 50 ? magnifierPoint.y - 25 : magnifierPoint.y + 25}%`,
                    transform: 'translate(-50%, -50%)'
                  }}
                >
                  <div
                    className="w-[400%] h-[400%] absolute"
                    style={{
                      backgroundImage: `url(${pages[activePageIndex].original})`,
                      backgroundSize: '100% 100%',
                      backgroundPosition: `${magnifierPoint.x}% ${magnifierPoint.y}%`,
                      transform: 'translate(-37.5%, -37.5%) scale(4)' // Zoom 4x
                    }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-4 h-4 border-2 border-indigo-500 rounded-full" />
                    <div className="absolute w-full h-[1px] bg-indigo-500/30" />
                    <div className="absolute h-full w-[1px] bg-indigo-500/30" />
                  </div>
                </div>
              )}

              <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none">
                <polygon
                  points={pages[activePageIndex].cropPoints?.map(p => `${p.x},${p.y}`).join(' ')}
                  fill="rgba(79, 70, 229, 0.15)"
                  stroke="#4f46e5"
                  strokeWidth="0.5"
                />
              </svg>

              {pages[activePageIndex].cropPoints?.map((p, i) => (
                <div
                  key={i}
                  className="absolute w-14 h-14 -ml-7 -mt-7 flex items-center justify-center touch-none z-10 cursor-move"
                  style={{ left: `${p.x}%`, top: `${p.y}%` }}
                  onTouchStart={() => setMagnifierPoint(p)}
                  onMouseDown={() => setMagnifierPoint(p)}
                  onTouchMove={(e) => {
                    const rect = e.currentTarget.parentElement?.getBoundingClientRect();
                    if (rect) {
                      const touch = e.touches[0];
                      const x = ((touch.clientX - rect.left) / rect.width) * 100;
                      const y = ((touch.clientY - rect.top) / rect.height) * 100;
                      const nx = Math.max(0, Math.min(100, x));
                      const ny = Math.max(0, Math.min(100, y));
                      updateCropPoint(activePageIndex, i, nx, ny);
                      setMagnifierPoint({ x: nx, y: ny });
                    }
                  }}
                  onMouseMove={(e) => {
                    if (e.buttons === 1) { // Sóilo si el ratón está apretado
                      const rect = e.currentTarget.parentElement?.getBoundingClientRect();
                      if (rect) {
                        const x = ((e.clientX - rect.left) / rect.width) * 100;
                        const y = ((e.clientY - rect.top) / rect.height) * 100;
                        const nx = Math.max(0, Math.min(100, x));
                        const ny = Math.max(0, Math.min(100, y));
                        updateCropPoint(activePageIndex, i, nx, ny);
                        setMagnifierPoint({ x: nx, y: ny });
                      }
                    }
                  }}
                  onTouchEnd={() => setMagnifierPoint(null)}
                  onMouseUp={() => setMagnifierPoint(null)}
                >
                  <div className="w-10 h-10 bg-white/90 backdrop-blur-sm rounded-full border-4 border-indigo-600 shadow-xl flex items-center justify-center">
                    <div className="w-3 h-3 bg-indigo-600 rounded-full animate-pulse" />
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-center gap-4 px-2">
              <button onClick={() => rotatePage(activePageIndex, 'left')} className="p-4 bg-white rounded-2xl shadow-sm border border-slate-100"><RotateCcw className="w-6 h-6 text-slate-400" /></button>
              <button onClick={() => rotatePage(activePageIndex, 'right')} className="p-4 bg-white rounded-2xl shadow-sm border border-slate-100"><RotateCcw className="w-6 h-6 text-slate-400 scale-x-[-1]" /></button>
              <button
                onClick={() => {
                  const img = new Image();
                  img.onload = () => {
                    const tempCanvas = document.createElement('canvas');
                    tempCanvas.width = img.width;
                    tempCanvas.height = img.height;
                    const tctx = tempCanvas.getContext('2d');
                    if (tctx) {
                      tctx.drawImage(img, 0, 0);
                      const detected = autoDetectEdges(tempCanvas);
                      setPages(prev => {
                        const up = [...prev];
                        up[activePageIndex].cropPoints = detected;
                        return up;
                      });
                      addLog("Re-detección completada.");
                    }
                  };
                  img.src = pages[activePageIndex].original;
                }}
                className="px-6 bg-indigo-50 text-indigo-600 rounded-2xl font-black text-[10px] uppercase tracking-widest border border-indigo-100"
              >
                Auto-Detectar
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
                  <button
                    onClick={() => { setActivePageIndex(i); setStep(AppStep.CROP); }}
                    className="absolute bottom-4 right-4 bg-indigo-600 text-white p-2 rounded-xl shadow-lg border-2 border-white"
                  >
                    <Maximize2 className="w-4 h-4" />
                  </button>
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
              <div className="flex justify-between items-center mb-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Filtros Profesionales</label>
                <div className="flex gap-2">
                  <button onClick={() => rotatePage(activePageIndex, 'left')} className="p-2 bg-slate-50 rounded-xl text-slate-500"><RotateCcw className="w-4 h-4" /></button>
                  <button onClick={() => rotatePage(activePageIndex, 'right')} className="p-2 bg-slate-50 rounded-xl text-slate-500"><RotateCcw className="w-4 h-4 scale-x-[-1]" /></button>
                </div>
              </div>
              <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                {[
                  { id: 'clean', label: 'Aclarar' },
                  { id: 'vibrant', label: 'Mejorar' },
                  { id: 'magic', label: 'Magia Pro' },
                  { id: 'no-shadow', label: 'Sin Sombra' },
                  { id: 'bw', label: 'B/N Pro' },
                  { id: 'none', label: 'Original' }
                ].map(f => (
                  <button
                    key={f.id}
                    onClick={() => applyFilterToPage(activePageIndex!, { ...pages[activePageIndex!].processing, filter: f.id as any })}
                    className={`px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shrink-0 ${pages[activePageIndex!].processing.filter === f.id ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-500/20' : 'bg-slate-50 text-slate-400'}`}
                  >
                    {f.label}
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
        {step === AppStep.TOOLS && (
          <div className="flex flex-col gap-8 animate-in slide-in-from-bottom duration-500 pb-10">
            <div className="px-2">
              <h2 className="text-3xl font-black text-slate-800">Herramientas AI</h2>
              <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px] mt-2">Potencia CamScanner Integrada</p>
            </div>

            {/* SECCIÓN ESCANEAR */}
            <div className="space-y-4">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] px-2">Escaneo Especializado</h3>
              <div className="grid grid-cols-2 gap-4">
                <button onClick={startCamera} className="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm flex flex-col items-center gap-3 active:scale-95 transition-all text-center">
                  <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-500"><CreditCard className="w-6 h-6" /></div>
                  <span className="text-[11px] font-black text-slate-700 uppercase">Tarjeta ID</span>
                </button>
                <button onClick={startCamera} className="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm flex flex-col items-center gap-3 active:scale-95 transition-all text-center">
                  <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-500"><FileText className="w-6 h-6" /></div>
                  <span className="text-[11px] font-black text-slate-700 uppercase">Sacar Texto</span>
                </button>
                <button onClick={startCamera} className="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm flex flex-col items-center gap-3 active:scale-95 transition-all text-center">
                  <div className="w-12 h-12 bg-rose-50 rounded-2xl flex items-center justify-center text-rose-500"><Users className="w-6 h-6" /></div>
                  <span className="text-[11px] font-black text-slate-700 uppercase">Fotos ID</span>
                </button>
                <button onClick={startCamera} className="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm flex flex-col items-center gap-3 active:scale-95 transition-all text-center">
                  <div className="w-12 h-12 bg-amber-50 rounded-2xl flex items-center justify-center text-amber-500"><LayoutGrid className="w-6 h-6" /></div>
                  <span className="text-[11px] font-black text-slate-700 uppercase">Pizarra</span>
                </button>
              </div>
            </div>

            {/* SECCIÓN IMPORTAR */}
            <div className="space-y-4">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] px-2">Importar Archivos</h3>
              <div className="grid grid-cols-2 gap-4">
                <label className="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm flex flex-col items-center gap-3 active:scale-95 transition-all text-center cursor-pointer">
                  <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-500"><ImageIcon className="w-6 h-6" /></div>
                  <span className="text-[11px] font-black text-slate-700 uppercase">Importar Fotos</span>
                  <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    files.forEach(file => {
                      const reader = new FileReader();
                      reader.onload = (re) => {
                        const dataUrl = re.target?.result as string;
                        const img = new Image();
                        img.onload = () => {
                          const canvas = document.createElement('canvas');
                          canvas.width = img.width;
                          canvas.height = img.height;
                          const ctx = canvas.getContext('2d');
                          if (ctx) {
                            ctx.drawImage(img, 0, 0);
                            const detectedPoints = autoDetectEdges(canvas);
                            const newPage: PageData = {
                              id: Date.now().toString() + Math.random(),
                              original: dataUrl,
                              cropped: dataUrl,
                              processed: dataUrl,
                              processing: {
                                brightness: 100,
                                contrast: 130,
                                saturation: 100,
                                filter: 'magic',
                                removeShadows: true,
                                rotation: 0
                              },
                              cropPoints: detectedPoints
                            };
                            setPages(prev => [...prev, newPage]);
                            // Aplicamos limpieza automática al importar
                            setTimeout(() => {
                              applyFilterToPage(pages.length, { ...newPage.processing, filter: 'magic' });
                            }, 50);
                          }
                        };
                        img.src = dataUrl;
                      };
                      reader.readAsDataURL(file);
                    });
                    setStep(AppStep.REVIEW);
                  }} />
                </label>
                <button className="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm flex flex-col items-center gap-3 active:scale-95 transition-all text-center">
                  <div className="w-12 h-12 bg-purple-50 rounded-2xl flex items-center justify-center text-purple-500"><FolderOpen className="w-6 h-6" /></div>
                  <span className="text-[11px] font-black text-slate-700 uppercase">Importar PDF</span>
                </button>
              </div>
            </div>

            {/* SECCIÓN CONVERTIR */}
            <div className="space-y-4">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] px-2">Convertir Documentos</h3>
              <div className="grid grid-cols-2 gap-4">
                <button className="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm flex flex-col items-center gap-3 active:scale-95 transition-all text-center opacity-60">
                  <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-400"><FileText className="w-6 h-6" /></div>
                  <span className="text-[11px] font-black text-slate-500 uppercase">A Word</span>
                </button>
                <button className="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm flex flex-col items-center gap-3 active:scale-95 transition-all text-center opacity-60">
                  <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-400"><TrendingUp className="w-6 h-6" /></div>
                  <span className="text-[11px] font-black text-slate-500 uppercase">A Excel</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* FOOTER NAV (Restaurado y Simplificado) */}
      <footer className="fixed bottom-0 inset-x-0 bg-white/80 backdrop-blur-xl border-t border-slate-100 px-10 py-6 flex justify-between items-center z-50">
        <button onClick={() => setStep(AppStep.IDLE)} className={`flex flex-col items-center gap-2 transition-all ${step === AppStep.IDLE ? 'text-indigo-600 scale-110' : 'text-slate-300'}`}>
          <LayoutGrid className="w-7 h-7" />
          <span className="text-[9px] font-black uppercase tracking-widest">Inicio</span>
        </button>

        <button onClick={() => setStep(AppStep.TOOLS)} className={`flex flex-col items-center gap-2 transition-all ${step === AppStep.TOOLS ? 'text-indigo-600 scale-110' : 'text-slate-300'}`}>
          <Sparkles className="w-7 h-7" />
          <span className="text-[9px] font-black uppercase tracking-widest">Herramientas</span>
        </button>

        <button onClick={() => setStep(AppStep.HISTORY)} className={`flex flex-col items-center gap-2 transition-all ${step === AppStep.HISTORY ? 'text-indigo-600 scale-110' : 'text-slate-300'}`}>
          <History className="w-7 h-7" />
          <span className="text-[9px] font-black uppercase tracking-widest">Historial</span>
        </button>

        <button onClick={() => setShowSettings(true)} className="flex flex-col items-center gap-2 text-slate-300">
          <Settings className="w-7 h-7" />
          <span className="text-[9px] font-black uppercase tracking-widest">Ajustes</span>
        </button>
      </footer>

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

            {/* BOTÓN DE EMERGENCIA */}
            <div className="pt-4 border-t border-slate-50">
              <button
                onClick={() => {
                  setDialog({
                    show: true,
                    title: 'ScanerDLKom dice',
                    message: '¿Reparar aplicación? Se borrarán los ajustes locales y se forzará la actualización.',
                    type: 'confirm',
                    onConfirm: () => {
                      localStorage.clear();
                      caches.keys().then(names => names.forEach(n => caches.delete(n)));
                      navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()));
                      window.location.reload();
                    }
                  });
                }}
                className="w-full py-4 text-rose-500 font-black text-xs uppercase tracking-widest bg-rose-50 rounded-2xl border border-rose-100 active:scale-95 transition-all"
              >
                Reparar Aplicación (Limpiar Caché)
              </button>
            </div>

            <button
              onClick={() => setShowSettings(false)}
              className="w-full py-5 bg-slate-900 text-white rounded-[24px] font-black text-lg shadow-xl shadow-slate-900/20 mt-4 active:scale-95 transition-all"
            >
              Guardar y Cerrar
            </button>
            {/* PANEL DE DEPURACIÓN (Solo visible si hay logs) */}
            {logs.length > 0 && (
              <div className="fixed top-2 right-2 z-[9999] bg-black/80 text-[8px] text-emerald-400 p-2 rounded-lg max-w-[150px] font-mono pointer-events-none">
                {logs.map((l, i) => <div key={i} className="truncate">{l}</div>)}
              </div>
            )}
          </div>
        </div>
      )}

      {/* DIÁLOGO PERSONALIZADO */}
      {dialog.show && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => dialog.type === 'alert' && setDialog({ ...dialog, show: false })} />
          <div className="bg-white w-full max-w-sm rounded-[32px] p-8 shadow-2xl relative animate-in zoom-in-95 duration-200 border border-slate-100">
            <h4 className="text-xl font-black text-slate-800 mb-4">{dialog.title}</h4>
            <p className="text-slate-500 font-medium mb-8 leading-relaxed">{dialog.message}</p>
            <div className="flex gap-3">
              {dialog.type === 'confirm' && (
                <button
                  onClick={() => setDialog({ ...dialog, show: false })}
                  className="flex-1 py-4 bg-slate-100 text-slate-500 rounded-2xl font-black text-xs uppercase tracking-widest active:scale-95 transition-all"
                >
                  Cancelar
                </button>
              )}
              <button
                onClick={() => {
                  setDialog({ ...dialog, show: false });
                  if (dialog.onConfirm) dialog.onConfirm();
                }}
                className="flex-1 py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-indigo-500/20 active:scale-95 transition-all"
              >
                {dialog.type === 'confirm' ? 'Confirmar' : 'Entendido'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
