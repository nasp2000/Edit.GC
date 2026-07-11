;********************************************************
;   Programmname   :  Tab Welding / SM300		*
;   Autor          :  Luis Almeida			*
;   Erstellt       :  23.07.2024			*
;   Version        :  1.0				*
;********************************************************

; Program Tab Welding


G98$SPROG$			; Star Program subprogram

SA3				; Close safety circuit DBM circuit board

; Laserprogram N1 is stored in R10 
RLAD R10;55			; Select laser program N1
RRBM R10;50;56			; Set Laser program

F5000				; Speed of the axis
X90 Y200 Z-50
X89 Y94.3 Z-50
X89 Y94.3 Z-222.4		; Move to start position
G22$L_TEST$01			; Test Laser locked
G22$L_READY$01			; Laser Ready
G48%=0005 TEIL: Test X-Y-Z                       $

SM12				;Protective Gas

SM3				;Laser start

X94 Y94.3 Z-222.4 F400		;***Part 01***

RM3				;Laser Stop

X115.7 Y94.7 Z-220.5 F5000	; First Positive Spot Weld

SM3

X115.7 Y94.71 Z-220.5 F500

RM3

X115.3 Y93.9 Z-220.5 F5000	; Second Positive Spot Weld

SM3

X115.3 Y93.91 Z-220.5 F500

RM3

X116.1 Y93.9 Z-220.5 F5000	; Third Positive Spot Weld

SM3

X116.1 Y93.91 Z-220.5 F500

RM3

X135.3 Y94.3 Z-222.4 F5000	;***Part 02***

SM3				;Laser start

X140.3 Y94.3 Z-222.4 F400

RM3				;Laser Stop

X161.7 Y94.6 Z-220.5 F5000	; First Positive Spot Weld

SM3

X161.7 Y94.61 Z-220.5 F500

RM3

X161.3 Y93.8 Z-220.5 F5000	; Second Positive Spot Weld

SM3

X161.3 Y93.81 Z-220.5 F500

RM3

X162.1 Y93.8 Z-220.5 F5000	; Third Positive Spot Weld

SM3

X162.1 Y93.81 Z-220.5 F500

RM3

X181.3 Y94.1 Z-222.4 F5000	;***Part 03***

SM3				;Laser start

X186.3 Y94.1 Z-222.4 F400

RM3				;Laser Stop

X207.65 Y94.4 Z-220.5 F5000	; First Positive Spot Weld

SM3

X207.65 Y94.41 Z-220.5 F500

RM3

X207.25 Y93.6 Z-220.5 F5000	; Second Positive Spot Weld

SM3

X207.25 Y93.61 Z-220.5 F500

RM3

X208.05 Y93.6 Z-220.5 F5000	; Third Positive Spot Weld

SM3

X208.05 Y93.61 Z-220.5 F500

RM3

X227.1 Y94 Z-222.4 F5000	;***Part 04***

SM3				;Laser start

X232.1 Y94 Z-222.4 F400

RM3				;Laser Stop

X253.7 Y94.4 Z-220.5 F5000	; First Positive Spot Weld

SM3

X253.7 Y94.41 Z-220.5 F500

RM3

X253.3 Y93.6 Z-220.5 F5000	; Second Positive Spot Weld

SM3

X253.3 Y93.61 Z-220.5 F500

RM3

X254.1 Y93.6 Z-220.5 F5000	; Third Positive Spot Weld

SM3

X254.1 Y93.61 Z-220.5 F500

RM3

X255 Y121.8 Z-222.4 F5000	;***Part 05***Second Row

SM3				;Laser start

X250 Y121.8 Z-222.4 F400

RM3				;Laser Stop

X228.2 Y121.5 Z-220.5 F5000	; First Positive Spot Weld

SM3

X228.2 Y121.51 Z-220.5 F500

RM3

X228.6 Y122.3 Z-220.5 F5000	; Second Positive Spot Weld

SM3

X228.6 Y122.31 Z-220.5 F500

RM3

X227.8 Y122.3 Z-220.5 F5000	; Third Positive Spot Weld

SM3

X227.8 Y122.31 Z-220.5 F500

RM3

X209 Y122 Z-222.4 F5000	;***Part 06***Second Row

SM3				;Laser start

X204 Y122 Z-222.4 F400

RM3				;Laser Stop

X182.2 Y121.6 Z-220.5 F5000	; First Positive Spot Weld

SM3

X182.2 Y121.61 Z-220.5 F500

RM3

X182.7 Y122.4 Z-220.5 F5000	; Second Positive Spot Weld

SM3

X182.7 Y122.41 Z-220.5 F500

RM3

X181.9 Y122.4 Z-220.5 F5000	; Third Positive Spot Weld

SM3

X181.9 Y122.41 Z-220.5 F500

RM3

X163 Y122.2 Z-222.4 F5000	;***Part 07***Second Row

SM3				;Laser start

X158 Y122.2 Z-222.4 F400

RM3				;Laser Stop

X136.2 Y121.8 Z-220.5 F5000	; First Positive Spot Weld

SM3

X136.2 Y121.81 Z-220.5 F500

RM3

X136.6 Y122.6 Z-220.5 F5000	; Second Positive Spot Weld

SM3

X136.6 Y122.61 Z-220.5 F500

RM3

X135.9 Y122.6 Z-220.5 F5000	; Third Positive Spot Weld

SM3

X135.9 Y122.61 Z-220.5 F500

RM3

X117 Y122.4 Z-222.4 F5000	;***Part 08***Second Row

SM3				;Laser start

X112 Y122.4 Z-222.4 F400

RM3				;Laser Stop

X90.2 Y121.9 Z-220.5 F5000	; First Positive Spot Weld

SM3

X90.2 Y121.91 Z-220.5 F500

RM3

X90.6 Y122.7 Z-220.5 F5000	; Second Positive Spot Weld

SM3

X90.6 Y122.71 Z-220.5 F500

RM3

X89.8 Y122.7 Z-220.5 F5000	; Third Positive Spot Weld

SM3

X89.8 Y122.71 Z-220.5 F500

RM3				;Laser stop

RM12				;Protective Gas stop

X89.8 Y122.71 Z-50 F5000

X90 Y200 Z-50

RA3				;Open safety DBM circuit board

G99				;End of Program subprogram