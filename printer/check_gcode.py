import sys, zipfile, re
g = zipfile.ZipFile(sys.argv[1]).read('Metadata/plate_1.gcode').decode(errors='ignore')
print(re.findall(r'M1002 gcode_claim_action : (\d+)', g))
