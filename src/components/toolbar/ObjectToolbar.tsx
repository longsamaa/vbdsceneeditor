import './ObjectToolbar.css';
import React, {useState} from "react";
import {
    RotateCcw,
    ArrowDownToLine,
    Scissors,
    Footprints
} from 'lucide-react';

interface ObjectToolbarProps {
    onResetPosition?: () => void;
    onSnapToGround?: () => void;
    enableClippingPlane?: (enable: boolean) => void;
    enableFootPrintWhenEdit?: (enable: boolean) => void;
}

export const ObjectToolbar: React.FC<ObjectToolbarProps> = ({
                                                                onResetPosition,
                                                                onSnapToGround,
                                                                enableClippingPlane,
                                                                enableFootPrintWhenEdit
                                                            }) => {
    const [clippingEnabled, setClippingEnabled] = useState(false);
    const [enableFootPrint, setEnableFootprint] = useState(false);

    return (
        <div className="object-panel">
            <button
                className="op-btn"
                onClick={onResetPosition}
                data-tooltip="Reset object position"
            >
                <RotateCcw size={16} />
            </button>

            <button
                className="op-btn"
                onClick={onSnapToGround}
                data-tooltip="Snap object to the ground"
            >
                <ArrowDownToLine size={16} />
            </button>

            <button
                className={`op-btn ${clippingEnabled ? 'op-btn-active' : ''}`}
                onClick={() => {
                    setClippingEnabled(!clippingEnabled);
                    enableClippingPlane?.(!clippingEnabled);
                }}
                data-tooltip="Enable the clipping plane to cut through objects"
            >
                <Scissors size={16} />
            </button>

            <button
                className={`op-btn ${enableFootPrint ? 'op-btn-active' : ''}`}
                onClick={() => {
                    setEnableFootprint(!enableFootPrint);
                    enableFootPrintWhenEdit?.(!enableFootPrint);
                }}
                data-tooltip="Display the object footprint on the ground"
            >
                <Footprints size={16} />
            </button>
        </div>
    );
};
