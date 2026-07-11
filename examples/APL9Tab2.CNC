;********************************************************
;   Programmname   :  Tab Welding / SM300		*
;   Autor          :  Samuel Pereira			*
;   Erstellt       :  09.09.2025			*
;   Version        :  1.0				*
;********************************************************

; Program Tab Welding


G98$SPROG$			; Star Program subprogram

SA3				; Close safety circuit DBM circuit board

; Laserprogram N1 is stored in R10 
RLAD R10;45			; Select laser program N1
RRBM R10;50;56			; Set Laser program

F5000				; Speed of the axis
X90 Y200 Z-50
X87.45 Y92.6 Z-100
X87.45 Y92.6 Z-230.33		; Move to start position
G22$L_TEST$01			; Test Laser locked
G22$L_READY$01			; Laser Ready
G48%=0005 TEIL: Test X-Y-Z                       $


SM12				;Protective Gas

SM3				;Laser start

X90.95 Y92.6 Z-230.33 F400	;***Part 01***

RM3

X99.6 Y93 Z-228 F2000	; First Positive Spot Weld

SM3

X99.6 Y92.99 Z-228 F500

RM3

X99.2 Y92.2 Z-228 F2000		; Second Positive Spot Weld

SM3

X99.2 Y92.19 Z-228 F500

RM3

X100 Y92.2 Z-228 F2000		; Third Positive Spot Weld

SM3

X100 Y92.19 Z-228 F500

RM3

X112.45 Y92.6 Z-230.33 F2000	;***Part 02***

SM3				;Laser start

X115.95 Y92.6 Z-230.33 F400	

RM3

X124.6 Y93 Z-228 F2000	; First Positive Spot Weld

SM3

X124.6 Y92.99 Z-228 F500

RM3

X124.2 Y92.2 Z-228 F2000		; Second Positive Spot Weld

SM3

X124.2 Y92.19 Z-228 F500

RM3

X125 Y92.2 Z-228 F2000		; Third Positive Spot Weld

SM3

X125 Y92.19 Z-228 F500

RM3

X137.45 Y92.6 Z-230.33 F2000	;***Part 03***

SM3				;Laser start

X140.95 Y92.6 Z-230.33 F400	

RM3

X149.6 Y93 Z-228 F2000	; First Positive Spot Weld

SM3

X149.6 Y92.99 Z-228 F500

RM3

X149.2 Y92.2 Z-228 F2000		; Second Positive Spot Weld

SM3

X149.2 Y92.19 Z-228 F500

RM3

X150 Y92.2 Z-228 F2000		; Third Positive Spot Weld

SM3

X150 Y92.19 Z-228 F500

RM3

X162.45 Y92.6 Z-230.33 F2000	;***Part 04***

SM3				;Laser start

X165.95 Y92.6 Z-230.33 F400	

RM3

X174.6 Y93 Z-228 F2000		; First Positive Spot Weld

SM3

X174.6 Y92.99 Z-228 F500

RM3

X174.2 Y92.2 Z-228 F2000		; Second Positive Spot Weld

SM3

X174.2 Y92.19 Z-228 F500

RM3

X175 Y92.2 Z-228 F2000		; Third Positive Spot Weld

SM3

X175 Y92.19 Z-228 F500

RM3

X187.45 Y92.6 Z-230.33 F2000	;***Part 05***

SM3				;Laser start

X190.95 Y92.6 Z-230.33 F400	

RM3

X199.6 Y93 Z-228 F2000		; First Positive Spot Weld

SM3

X199.6 Y92.99 Z-228 F500

RM3

X199.2 Y92.2 Z-228 F2000		; Second Positive Spot Weld

SM3

X199.2 Y92.19 Z-228 F500

RM3

X200 Y92.2 Z-228 F2000		; Third Positive Spot Weld

SM3

X200 Y92.19 Z-228 F500

RM3

X212.45 Y92.6 Z-230.33 F2000	;***Part 06***

SM3				;Laser start

X215.95 Y92.6 Z-230.33 F400	

RM3

X224.6 Y93 Z-228 F2000	; First Positive Spot Weld

SM3

X224.6 Y92.99 Z-228 F500

RM3

X224.2 Y92.2 Z-228 F2000		; Second Positive Spot Weld

SM3

X224.2 Y92.19 Z-228 F500

RM3

X225 Y92.2 Z-228 F2000		; Third Positive Spot Weld

SM3

X225 Y92.19 Z-228 F500

RM3

X237.45 Y92.6 Z-230.33 F2000	;***Part 07***

SM3				;Laser start

X240.95 Y92.6 Z-230.33 F400	

RM3

X249.6 Y93 Z-228 F2000	; First Positive Spot Weld

SM3

X249.6 Y92.99 Z-228 F500

RM3

X249.2 Y92.2 Z-228 F2000		; Second Positive Spot Weld

SM3

X249.2 Y92.19 Z-228 F500

RM3

X250 Y92.2 Z-228 F2000		; Third Positive Spot Weld

SM3

X250 Y92.19 Z-228 F500

RM3

X251.15 Y123.2 Z-230.33 F2000	;***Part 08*** second row

SM3				;Laser start

X247.65 Y123.2 Z-230.33 F400	

RM3

X239.65 Y123 Z-228 F2000	; First Positive Spot Weld

SM3

X239.65 Y123.01 Z-228 F500

RM3

X240.05 Y123.8 Z-228 F2000	; Second Positive Spot Weld

SM3

X240.05 Y123.81 Z-228 F500

RM3

X239.25 Y123.8 Z-228 F2000	; Third Positive Spot Weld

SM3

X239.25 Y123.81 Z-228 F500

RM3

X226.15 Y123.2 Z-230.33 F2000	;***Part 09***

SM3				;Laser start

X222.65 Y123.2 Z-230.33 F400	

RM3

X214.65 Y123 Z-228 F2000	; First Positive Spot Weld

SM3

X214.65 Y123.01 Z-228 F500

RM3

X215.05 Y123.8 Z-228 F2000	; Second Positive Spot Weld

SM3

X215.05 Y123.81 Z-228 F500

RM3

X214.25 Y123.8 Z-228 F2000	; Third Positive Spot Weld

SM3

X214.25 Y123.81 Z-228 F500

RM3

X201.15 Y123.2 Z-230.33 F2000	;***Part 10***

SM3				;Laser start

X197.65 Y123.2 Z-230.33 F400	

RM3

X189.65 Y123 Z-228 F2000	; First Positive Spot Weld

SM3

X189.65 Y123.01 Z-228 F500

RM3

X190.05 Y123.8 Z-228 F2000	; Second Positive Spot Weld

SM3

X190.05 Y123.81 Z-228 F500

RM3

X189.25 Y123.8 Z-228 F2000	; Third Positive Spot Weld

SM3

X189.25 Y123.81 Z-228 F500

RM3

X176.15 Y123.2 Z-230.33 F2000	;***Part 11***

SM3				;Laser start

X172.65 Y123.2 Z-230.33 F400	

RM3

X164.65 Y123 Z-228 F2000	; First Positive Spot Weld

SM3

X164.65 Y123.01 Z-228 F500

RM3

X165.05 Y123.8 Z-228 F2000	; Second Positive Spot Weld

SM3

X165.05 Y123.81 Z-228 F500

RM3

X164.25 Y123.8 Z-228 F2000	; Third Positive Spot Weld

SM3

X164.25 Y123.81 Z-228 F500

RM3

X151.15 Y123.2 Z-230.33 F2000	;***Part 12***

SM3				;Laser start

X147.65 Y123.2 Z-230.33 F400	

RM3

X139.65 Y123 Z-228 F2000	; First Positive Spot Weld

SM3

X139.65 Y123.01 Z-228 F500

RM3

X140.05 Y123.8 Z-228 F2000	; Second Positive Spot Weld

SM3

X140.05 Y123.81 Z-228 F500

RM3

X139.25 Y123.8 Z-228 F2000	; Third Positive Spot Weld

SM3

X139.25 Y123.81 Z-228 F500

RM3

X126.15 Y123.2 Z-230.33 F2000	;***Part 13***

SM3				;Laser start

X122.65 Y123.2 Z-230.33 F400	

RM3

X114.65 Y123 Z-228 F2000	; First Positive Spot Weld

SM3

X114.65 Y123.01 Z-228 F500

RM3

X115.05 Y123.8 Z-228 F2000	; Second Positive Spot Weld

SM3

X115.05 Y123.81 Z-228 F500

RM3

X114.25 Y123.8 Z-228 F2000	; Third Positive Spot Weld

SM3

X114.25 Y123.81 Z-228 F500

RM3

X101.15 Y123.2 Z-230.33 F2000	;***Part 14***

SM3				;Laser start

X97.65 Y123.2 Z-230.33 F400	

RM3

X89.65 Y123 Z-228 F2000	; First Positive Spot Weld

SM3

X89.65 Y123.01 Z-228 F500

RM3

X90.05 Y123.8 Z-228 F2000	; Second Positive Spot Weld

SM3

X90.05 Y123.81 Z-228 F500

RM3

X89.25 Y123.8 Z-228 F2000	; Third Positive Spot Weld

SM3

X89.25 Y123.81 Z-228 F500

RM3

X90 Y200 Z-200 F5000

X90 Y200 Z-50

RM12				;Protective Gas
RA3				;Open safety DBM circuit board

G99				;End of Program subprogram