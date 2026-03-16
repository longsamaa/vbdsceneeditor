import {useState, useRef, lazy, Suspense} from "react";
import MapView from './components/map/MapView';
import {TransformToolbar} from './components/toolbar/TransformToolbar';
import {ObjectToolbar} from './components/toolbar/ObjectToolbar'
import type {TransformMode} from './components/toolbar/TransformToolbar';
import type {MapViewHandle} from './components/map/MapView'

const ReteEditor = lazy(() => import('./components/nodeeditor/ReteEditor'));

function App() {
    const [mode, setMode] = useState<TransformMode>('translate');
    const [showNodeEditor, setShowNodeEditor] = useState(false);
    const mapHandleRef = useRef<MapViewHandle>(null);
    //mock data layer
    return (
        <div className="App">
            <MapView
                center={[106.69566421040963,10.730013837481494]}
                zoom={17}
                ref={mapHandleRef}
            />
            <TransformToolbar
                mode={mode}
                onChange={(mode) => {
                    setMode(mode);
                    mapHandleRef.current?.setTransformMode(mode);
                }}
            />
            <ObjectToolbar
                onResetPosition={() => {
                    mapHandleRef.current?.resetPosOfObjectSelected();
                }}
                onSnapToGround={() => {
                    mapHandleRef.current?.snapObjectSelectedToGround();
                }}
                enableClippingPlane={(enable: boolean) => {
                    mapHandleRef.current?.enableClippingPlanesObjectSelected(enable);
                }}
                enableFootPrintWhenEdit={(enable: boolean) => {
                    mapHandleRef.current?.enableFootPrintWhenEdit(enable);
                }}
            />
            <button
                onClick={() => setShowNodeEditor(true)}
                title="Node Editor"
                style={{
                    position: 'fixed',
                    top: 400,
                    left: 10,
                    zIndex: 10000,
                    background: '#4a90d9',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 8,
                    width: 40,
                    height: 40,
                    padding: 0,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                }}
            >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="3" width="7" height="7" rx="1.5" />
                    <rect x="15" y="14" width="7" height="7" rx="1.5" />
                    <path d="M9 6.5h3a2 2 0 0 1 2 2v7a2 2 0 0 0 2 2h-1" />
                </svg>
            </button>
            {showNodeEditor && (
                <Suspense fallback={<div style={{position:'fixed',inset:0,zIndex:9999,background:'#1e1e1e',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center'}}>Loading...</div>}>
                    <ReteEditor onClose={() => setShowNodeEditor(false)} />
                </Suspense>
            )}
        </div>
    );
}

export default App;
