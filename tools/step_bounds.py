"""Absolute STEP roundtrip size tolerance in mm; independent of model size."""
BOUND_TOLERANCE_MM = 0.01

def compare_bounds(source, loaded):
    deltas = {key: abs(source[key] - loaded[key]) for key in source}
    maximum = max(deltas.values(), default=0)
    return {'source_bounds_mm': source, 'loaded_bounds_mm': loaded,
            'deltas_mm': deltas, 'max_delta_mm': maximum,
            'tolerance_mm': BOUND_TOLERANCE_MM,
            'passed': maximum <= BOUND_TOLERANCE_MM}
