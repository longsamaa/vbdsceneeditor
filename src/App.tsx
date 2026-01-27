import {useState, useRef} from "react";
import MapView from './components/map/MapView';
import {TransformToolbar} from './components/toolbar/TransformToolbar';
import {ObjectToolbar} from './components/toolbar/ObjectToolbar'
import type {TransformMode} from './components/toolbar/TransformToolbar';
import type {MapViewHandle} from './components/map/MapView'

function App() {
    const [mode, setMode] = useState<TransformMode>('translate');
    const mapHandleRef = useRef<MapViewHandle>(null);
    //mock data layer
    return (
        <div className="App">
            <MapView
                center={[106.72917030411851, 10.797981541869406]}
                zoom={16}
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
        </div>
    );
}

export default App;
