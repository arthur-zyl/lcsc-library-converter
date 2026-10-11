if {$argc != 4} {error "Expected DLL input.xml output.olb roundtrip.xml"}
lassign $argv dll input output roundtrip
load $dll DboTclWriteBasic
XMATIC_XML2OLB $input $output
if {![file exists $output]} {error "Capture did not generate OLB"}
XMATIC_OLB2XML $output $roundtrip
if {![file exists $roundtrip]} {error "Capture did not generate roundtrip XML"}
puts "HUB_CAPTURE_OK"
