/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copyright (C) 2023 Bilibili.
 * @author zheng qian <xqq@xqq.im>
 * 
 * Modified by Slavik Lozben.
 * Additional changes Copyright (C) 2025 Veovera Software Organization.
 *
 * See Git history for full details.
 */
 

import _Browser from '../utils/browser';
import { IDRFrameList } from '../core/media-segment-info';

const Browser: any = _Browser;  // !!@ make it more type safe

class SeekingHandler {

    private readonly TAG: string = 'SeekingHandler';

    private _config: any;   // !!@ move away from any
    private _media_element: HTMLMediaElement;
    private _always_seek_keyframe: boolean = false;
    private _on_unbuffered_seek: (milliseconds: number) => void;

    private _request_set_current_time: boolean = false;
    private _seek_request_record_clocktime: number | null = null;
    private _idr_sample_list: IDRFrameList = new IDRFrameList();

    private e?: any = null;

    public constructor(
        config: any,
        media_element: HTMLMediaElement,
        on_unbuffered_seek: (milliseconds: number) => void
    ) {
        this._config = config;
        this._media_element = media_element;
        this._on_unbuffered_seek = on_unbuffered_seek;

        this.e = {
            onMediaSeeking: this._onMediaSeeking.bind(this),
        };

        let chrome_need_idr_fix = (Browser.chrome &&
                                  (Browser.version.major < 50 ||
                                  (Browser.version.major === 50 && Browser.version.build < 2661)));
        this._always_seek_keyframe = (chrome_need_idr_fix || Browser.msedge || Browser.msie) ? true : false;
        if (this._always_seek_keyframe) {
            this._config.accurateSeek = false;
        }

        this._media_element.addEventListener('seeking', this.e.onMediaSeeking);
    }

    public destroy(): void {
        this._idr_sample_list.clear();
        this._media_element.removeEventListener('seeking', this.e.onMediaSeeking);
    }

    public seek(seconds: number): void {
        const direct_seek: boolean = this._isPositionBuffered(seconds);
        let direct_seek_to_video_begin: boolean = false;

        if (seconds < 1.0 && this._media_element.buffered.length > 0) {
            const video_begin_time = this._media_element.buffered.start(0);
            if ((video_begin_time < 1.0 && seconds < video_begin_time) || Browser.safari) {
                direct_seek_to_video_begin = true;
                // Workaround for Safari: Seek to 0 may cause video stuck, use 0.1 to avoid
                seconds = Browser.safari ? 0.1 : video_begin_time;
            }
        }

        if (direct_seek_to_video_begin) {
            this.directSeek(seconds);
        } else if (direct_seek) {
            if (!this._always_seek_keyframe) {
                this.directSeek(seconds);
            } else {
                // For some old browsers we have to seek to keyframe
                // Seek to nearest keyframe if possible
                const idr = this._getNearestKeyframe(Math.floor(seconds * 1000));
                if (idr != null) {
                    seconds = idr.dts / 1000;
                }
                this.directSeek(seconds);
            }
        } else {
            this._idr_sample_list.clear();
            this._on_unbuffered_seek(Math.floor(seconds * 1000));  // In milliseconds
            if (this._config.accurateSeek) {
                this.directSeek(seconds);
            }
            // else: Wait for recommend_seekpoint callback
        }
    }

    public directSeek(seconds: number): void {
        this._request_set_current_time = true;
        this._media_element.currentTime = seconds;
    }

    public appendSyncPoints(syncpoints: any[]): void {
        this._idr_sample_list.appendArray(syncpoints);
    }

    // Handle seeking request from browser's progress bar or HTMLMediaElement.currentTime setter
    private _onMediaSeeking(e: Event): void {
        if (this._request_set_current_time) {
            this._request_set_current_time = false;
            return;
        }

        let target: number = this._media_element.currentTime;
        const buffered: TimeRanges = this._media_element.buffered;

        // Handle seeking to video begin (near 0.0s)
        if (target < 1.0 && buffered.length > 0) {
            let video_begin_time = buffered.start(0);
            if ((video_begin_time < 1.0 && target < video_begin_time) || Browser.safari) {
                // Safari may get stuck if currentTime set to 0, use 0.1 to avoid
                let target: number = Browser.safari ? 0.1 : video_begin_time;
                this.directSeek(target);
                return;
            }
        }

        // Handle in-buffer seeking (usually nothing to do)
        if (this._isPositionBuffered(target)) {
            if (this._always_seek_keyframe) {
                const idr = this._getNearestKeyframe(Math.floor(target * 1000));
                if (idr != null) {
                    target = idr.dts / 1000;
                    this.directSeek(target);
                }
            }
            return;
        }

        // else: Prepare for unbuffered seeking
        // Defer the unbuffered seeking since the seeking bar maybe still being draged
        this._seek_request_record_clocktime = SeekingHandler._getClockTime();
        window.setTimeout(this._pollAndApplyUnbufferedSeek.bind(this), 50);

    }

    private _pollAndApplyUnbufferedSeek(): void {
        if (this._seek_request_record_clocktime == null) {
            return;
        }

        const record_time: number = this._seek_request_record_clocktime;
        if (record_time <= SeekingHandler._getClockTime() - 100) {
            const target = this._media_element.currentTime;
            this._seek_request_record_clocktime = null;
            if (!this._isPositionBuffered(target)) {
                this._idr_sample_list.clear();
                this._on_unbuffered_seek(Math.floor(target * 1000));  // In milliseconds
                // Update currentTime if using accurateSeek, or wait for recommend_seekpoint callback
                if (this._config.accurateSeek) {
                    this.directSeek(target);
                }
            }
        } else {
            window.setTimeout(this._pollAndApplyUnbufferedSeek.bind(this), 50);
        }
    }

    private _isPositionBuffered(seconds: number): boolean {
        const buffered = this._media_element.buffered;

        for (let i = 0; i < buffered.length; i++) {
            const from = buffered.start(i);
            const to = buffered.end(i);
            if (seconds >= from && seconds < to) {
                return true;
            }
        }

        return false;
    }

    private _getNearestKeyframe(dts: number): any {
        return this._idr_sample_list.getLastSyncPointBeforeDts(dts);
    }

    private static _getClockTime(): number {
        if (self.performance && self.performance.now) {
            return self.performance.now();
        } else {
            return Date.now();
        }
    }

}

export default SeekingHandler;
