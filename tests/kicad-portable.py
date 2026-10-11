"""Create a board outside the library directory to test portable 3D resources."""
import sys
from pathlib import Path
import pcbnew
root=Path(sys.argv[1]).resolve()
root.mkdir(parents=True,exist_ok=True)
library=Path(sys.argv[2]).resolve()
board=pcbnew.BOARD()
fp=pcbnew.FootprintLoad(str(library),sys.argv[3])
fp.SetFPID(pcbnew.LIB_ID('LCSC',sys.argv[3]))
fp.SetReference('U1')
board.Add(fp)
for a,b in [((-5,-5),(5,-5)),((5,-5),(5,5)),((5,5),(-5,5)),((-5,5),(-5,-5))]:
    edge=pcbnew.PCB_SHAPE()
    edge.SetShape(pcbnew.SHAPE_T_SEGMENT)
    edge.SetStart(pcbnew.VECTOR2I(int(a[0]*1e6),int(a[1]*1e6)))
    edge.SetEnd(pcbnew.VECTOR2I(int(b[0]*1e6),int(b[1]*1e6)))
    edge.SetLayer(pcbnew.Edge_Cuts)
    edge.SetWidth(50000)
    board.Add(edge)
pcbnew.SaveBoard(str(root/'test.kicad_pcb'),board)
